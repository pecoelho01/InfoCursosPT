from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data" / "dges-courses.json"
CACHE = ROOT / "public" / "data" / ".dges-cache"
BASE_URL = "https://www.dges.gov.pt/guias/"
LETTERS = "ABCDEFGHIJLMNOPQRSTVZ"
USER_AGENT = "Mozilla/5.0 InfoCursosPT/0.1"
MAX_WORKERS = max(1, int(os.environ.get("DGES_WORKERS", "4")))
FETCH_RETRIES = max(1, int(os.environ.get("DGES_FETCH_RETRIES", "4")))


def fetch(url: str, cache_name: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / cache_name
    if target.exists():
        return target.read_text(encoding="utf-8")

    for attempt in range(1, FETCH_RETRIES + 1):
        request = Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
            break
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            if attempt == FETCH_RETRIES:
                raise RuntimeError(f"Could not fetch {url}: {error}") from error
            time.sleep(1.5 * attempt)

    text = raw.decode("iso-8859-1", errors="replace")
    target.write_text(text, encoding="utf-8")
    time.sleep(0.03)
    return text


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").replace("\xa0", " ").strip()


def number(value: str | None):
    value = clean(value)
    if not value:
        return None
    value = value.replace(".", "").replace(",", ".")
    try:
        parsed = float(value)
    except ValueError:
        return value
    return int(parsed) if parsed.is_integer() else parsed


def text_after(label: str, text: str) -> str | None:
    match = re.search(rf"{re.escape(label)}:\s*([^<\n]+)", text)
    return clean(match.group(1)) if match else None


def section_html(title: str, text: str) -> str | None:
    match = re.search(rf"<h2[^>]*>\s*{re.escape(title)}\s*</h2>(.*?)(?=<h2[^>]*>|<a name=|$)", text, re.I | re.S)
    return match.group(1) if match else None


def html_lines(fragment: str | None) -> list[str]:
    if not fragment:
        return []
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    return [clean(line) for line in fragment.splitlines() if clean(line)]


def parse_admission_exams(text: str) -> dict | None:
    lines = html_lines(section_html("Provas de Ingresso", text))
    if not lines:
        return None

    raw = " · ".join(lines)
    exams = []
    for line in lines:
        match = re.match(r"^(\d{2})\s+(.+)$", line)
        if match:
            exams.append({"code": match.group(1), "name": clean(match.group(2))})

    return {"raw": raw, "exams": exams}


def parse_access_formula(text: str, secondary_weight, exam_weight) -> dict | None:
    lines = html_lines(section_html("Fórmula de Cálculo", text))
    if not lines and secondary_weight is None and exam_weight is None:
        return None
    return {
        "raw": " · ".join(lines) if lines else None,
        "secondaryWeight": secondary_weight,
        "examWeight": exam_weight,
    }


def parse_index_letter(letter: str) -> list[dict]:
    url = urljoin(BASE_URL, f"indcurso.asp?letra={letter}")
    doc = html.fromstring(fetch(url, f"index-{letter}.html"))
    items = []
    current_course = None

    for node in doc.xpath("//div[contains(@class,'box10') or contains(@class,'lin-curso')]"):
        classes = node.get("class", "")
        if "box10" in classes:
            current_course = {
                "courseCode": clean(" ".join(node.xpath(".//div[contains(@class,'lin-area-c1')]//text()"))),
                "name": clean(" ".join(node.xpath(".//div[contains(@class,'lin-area-c2')]//text()"))),
                "degreeShort": clean(" ".join(node.xpath(".//div[contains(@class,'lin-area-c3')]//text()"))).strip("[]"),
            }
            continue

        if "lin-curso" in classes and current_course:
            link = node.xpath(".//a")
            if not link:
                continue
            href = link[0].get("href")
            institution = clean(" ".join(link[0].xpath(".//text()")))
            institution_code = clean(" ".join(node.xpath(".//div[contains(@class,'lin-curso-c2')]//text()")))
            params = parse_qs(urlparse(href).query)
            institution_code = institution_code or clean(params.get("code", [""])[0])
            vacancies = number(" ".join(node.xpath(".//div[contains(@class,'lin-curso-c4')]//text()")))
            items.append(
                {
                    **current_course,
                    "institution": institution,
                    "institutionCode": institution_code,
                    "vacancies2026": vacancies,
                    "detailUrl": urljoin(BASE_URL, href),
                }
            )

    return items


def phase_headers(table) -> list[dict]:
    years = [clean(" ".join(th.xpath(".//text()"))) for th in table.xpath(".//tr[1]/th")]
    phases = [clean(" ".join(td.xpath(".//text()"))) for td in table.xpath(".//tr[2]/*[position()>1]")]
    headers = []
    for index, phase in enumerate(phases):
        year = years[index // 2] if years else None
        headers.append({"year": year, "phase": phase})
    return headers


def parse_stats(table) -> dict:
    headers = phase_headers(table)
    stats = {f"{header['year']} {header['phase']}": {**header} for header in headers}
    section = None

    for row in table.xpath(".//tr[position()>2]"):
        label = clean(" ".join(row.xpath("./th[1]//text()")))
        if not label:
            continue
        cells = [number(" ".join(cell.xpath(".//text()"))) for cell in row.xpath("./td")]

        is_header_row = label in {"Candidatos", "Colocados", "Médias dos Colocados"} and all(value is None for value in cells)
        if is_header_row:
            section = label
            continue

        field = None
        if label == "Vagas":
            field = "vacancies"
        elif section == "Candidatos" and label == "Candidatos":
            field = "applicants"
        elif section == "Candidatos" and label == "do Sexo Feminino":
            field = "applicantsFemale"
        elif section == "Candidatos" and label == "do Sexo Masculino":
            field = "applicantsMale"
        elif section == "Candidatos" and label == "em 1ª Opção":
            field = "firstChoiceApplicants"
        elif section == "Colocados" and label == "Colocados":
            field = "placed"
        elif section == "Colocados" and label == "do Sexo Feminino":
            field = "placedFemale"
        elif section == "Colocados" and label == "do Sexo Masculino":
            field = "placedMale"
        elif section == "Colocados" and label == "em 1ª Opção":
            field = "firstChoicePlaced"
        elif section == "Médias dos Colocados" and label == "Nota de Candidatura":
            field = "averageAdmissionGrade"
        elif section == "Médias dos Colocados" and label == "Provas de Ingresso":
            field = "averageExamGrade"
        elif section == "Médias dos Colocados" and label == "Média do Secundário":
            field = "averageSecondaryGrade"
        elif label == "Nota de Candidatura do Último Colocado pelo Contingente Geral":
            field = "lastPlacedGrade"

        if field:
            for index, value in enumerate(cells[: len(headers)]):
                stats[f"{headers[index]['year']} {headers[index]['phase']}"][field] = value

    return {"phases": list(stats.values())}


def parse_detail(item: dict) -> dict:
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{item['institutionCode']}_{item['courseCode']}")
    doc = html.fromstring(fetch(item["detailUrl"], f"detail-{safe_id}.html"))
    page_text = html.tostring(doc, encoding="unicode", method="html")
    visible = clean(" ".join(doc.xpath("//div[contains(@class,'inside2')]//text()")))
    formula = re.search(
        r"Fórmula de Cálculo</h2>\s*Média do secundário:\s*([0-9,.]+)%<br>\s*Provas de ingresso:\s*([0-9,.]+)%",
        page_text,
    )
    secondary_weight = number(formula.group(1)) if formula else None
    exam_weight = number(formula.group(2)) if formula else None

    course = {
        **item,
        "id": f"{item['institutionCode']}/{item['courseCode']}",
        "source": item["detailUrl"],
        "degree": text_after("Grau", page_text) or item.get("degreeShort"),
        "area": text_after("Área CNAEF", page_text),
        "duration": text_after("Duração", page_text),
        "ects": number(text_after("ECTS", page_text)),
        "teachingType": text_after("Tipo de Ensino", page_text),
        "contest": text_after("Concurso", page_text),
        "applicationMinimum": number(text_after("Nota de candidatura", page_text)),
        "examMinimum": number(text_after("Provas de ingresso", page_text)),
        "secondaryWeight": secondary_weight,
        "examWeight": exam_weight,
        "admissionExams": parse_admission_exams(page_text),
        "accessFormula": parse_access_formula(page_text, secondary_weight, exam_weight),
        "search": clean(f"{item['name']} {item['institution']} {item['institutionCode']} {item['courseCode']} {visible}").lower(),
    }

    stats_table = doc.xpath("//table[contains(@summary,'Dados de anos anteriores')]")
    if stats_table:
        course["statistics"] = parse_stats(stats_table[0])

    latest = latest_phase(course, year="2025", phase="1ª Fase") or latest_phase(course)
    if latest:
        course["latest"] = latest
        course["demandRatio"] = ratio(latest.get("applicants"), latest.get("vacancies"))
        course["occupancyRate"] = ratio(latest.get("placed"), latest.get("vacancies"), scale=100)

    return course


def latest_phase(course: dict, year: str | None = None, phase: str | None = None) -> dict | None:
    phases = course.get("statistics", {}).get("phases", [])
    candidates = [
        phase_data
        for phase_data in phases
        if (year is None or phase_data.get("year") == year) and (phase is None or phase_data.get("phase") == phase)
    ]
    for phase_data in reversed(candidates):
        if any(phase_data.get(key) is not None for key in ["applicants", "placed", "lastPlacedGrade"]):
            return phase_data
    return None


def ratio(part, total, scale=1):
    if not isinstance(part, (int, float)) or not isinstance(total, (int, float)) or total == 0:
        return None
    return round((part / total) * scale, 2)


def main():
    print("Reading DGES course index...", flush=True)
    indexed = []
    for letter in LETTERS:
        letter_items = parse_index_letter(letter)
        indexed.extend(letter_items)
        print(f"Index {letter}: {len(letter_items)} entries", flush=True)

    seen = {}
    for item in indexed:
        seen[f"{item['institutionCode']}/{item['courseCode']}"] = item
    items = list(seen.values())
    print(f"Found {len(items)} institution/course pairs", flush=True)

    courses = []
    errors = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(parse_detail, item) for item in items]
        for index, future in enumerate(as_completed(futures), start=1):
            try:
                courses.append(future.result())
            except Exception as error:
                errors.append(str(error))
                print(f"Failed to parse one detail page: {error}", flush=True)
            if index % 100 == 0:
                print(f"Parsed {index}/{len(items)}", flush=True)

    if errors:
        raise RuntimeError(f"Failed to parse {len(errors)} detail pages; refusing to write partial DGES data.")

    courses.sort(key=lambda item: (item.get("name") or "", item.get("institution") or ""))
    meta = {
        "source": "https://www.dges.gov.pt/guias/indcurso.asp",
        "generatedFrom": "DGES Guia da Candidatura 2026",
        "courseCount": len(courses),
        "fields": [
            "vagas 2026",
            "candidatos 2023-2025",
            "colocados 2023-2025",
            "nota do último colocado",
            "médias dos colocados",
            "condições de acesso",
            "provas de ingresso",
            "fórmula de cálculo",
        ],
    }
    OUTPUT.write_text(json.dumps({"meta": meta, "courses": courses}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(courses)} courses to {OUTPUT}", flush=True)


if __name__ == "__main__":
    main()
