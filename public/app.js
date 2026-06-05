const state = {
  courses: [],
  filtered: [],
  selectedId: null,
  compare: [],
  visible: 18,
};

const els = {
  searchPanel: document.querySelector(".search-panel"),
  query: document.querySelector("#query"),
  sort: document.querySelector("#sort"),
  contest: document.querySelector("#natureFilter"),
  teachingType: document.querySelector("#systemFilter"),
  degree: document.querySelector("#degreeFilter"),
  institution: document.querySelector("#institutionFilter"),
  area: document.querySelector("#areaFilter"),
  minGrade: document.querySelector("#maxUnemployment"),
  minGradeValue: document.querySelector("#maxUnemploymentValue"),
  onlyWithGrade: document.querySelector("#onlyWithEntry"),
  resetFilters: document.querySelector("#resetFilters"),
  filters: document.querySelector(".filters"),
  resultsArea: document.querySelector(".results-area"),
  coursePage: document.querySelector("#coursePage"),
  backToResults: document.querySelector("#backToResults"),
  cards: document.querySelector("#cards"),
  loadMore: document.querySelector("#loadMore"),
  visibleRange: document.querySelector("#visibleRange"),
  statCourses: document.querySelector("#statCourses"),
  statInstitutions: document.querySelector("#statInstitutions"),
  statAvgLastGrade: document.querySelector("#statAvgCompletion"),
  statDemand: document.querySelector("#statAvgUnemployment"),
  detailContent: document.querySelector("#detailContent"),
  detailsTitle: document.querySelector("#details-title"),
  compareSelected: document.querySelector("#compareSelected"),
  compareList: document.querySelector("#compareList"),
  clearCompare: document.querySelector("#clearCompare"),
};

const fmt = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });

fetch("data/dges-courses.json")
  .then((response) => response.json())
  .then((data) => {
    state.courses = data.courses;
    hydrateFilters();
    bindEvents();
    applyFilters();
    renderCompare();
    openCourseFromHash();
  })
  .catch(() => {
    els.cards.innerHTML = `<div class="empty-state">Não foi possível carregar os dados da DGES.</div>`;
  });

function bindEvents() {
  els.searchPanel.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  [
    els.query,
    els.sort,
    els.contest,
    els.teachingType,
    els.degree,
    els.institution,
    els.area,
    els.minGrade,
    els.onlyWithGrade,
  ].forEach((el) => el.addEventListener("input", applyFilters));

  els.loadMore.addEventListener("click", () => {
    state.visible += 18;
    renderCards();
  });

  els.resetFilters.addEventListener("click", () => {
    els.query.value = "";
    els.contest.value = "";
    els.teachingType.value = "";
    els.degree.value = "";
    els.institution.value = "";
    els.area.value = "";
    els.minGrade.value = "0";
    els.onlyWithGrade.checked = false;
    els.sort.value = "demand";
    applyFilters();
  });

  els.backToResults.addEventListener("click", () => {
    showResults();
  });

  els.compareSelected.addEventListener("click", () => {
    const course = findCourse(state.selectedId);
    if (course && !state.compare.includes(course.id)) {
      state.compare = [...state.compare, course.id].slice(-3);
      renderCompare();
    }
  });

  els.clearCompare.addEventListener("click", () => {
    state.compare = [];
    renderCompare();
  });

  window.addEventListener("hashchange", openCourseFromHash);
}

function hydrateFilters() {
  fillSelect(els.contest, "Todos", unique("contest"));
  fillSelect(els.teachingType, "Todos", unique("teachingType"));
  fillSelect(els.degree, "Todos", unique("degree"));
  fillSelect(els.institution, "Todas", unique("institution"));
  fillSelect(els.area, "Todas", unique("area"));
}

function unique(field) {
  return [...new Set(state.courses.map((course) => course[field]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt"),
  );
}

function fillSelect(select, label, values) {
  select.innerHTML = [`<option value="">${label}</option>`, ...values.map((value) => `<option>${escapeHtml(value)}</option>`)].join("");
}

function applyFilters() {
  const query = normalize(els.query.value);
  const minGrade = Number(els.minGrade.value);
  els.minGradeValue.textContent = minGrade === 0 ? "Sem mínimo" : fmt.format(minGrade);

  state.filtered = state.courses.filter((course) => {
    if (query && !normalize(course.search).includes(query)) return false;
    if (els.contest.value && course.contest !== els.contest.value) return false;
    if (els.teachingType.value && course.teachingType !== els.teachingType.value) return false;
    if (els.degree.value && course.degree !== els.degree.value) return false;
    if (els.institution.value && course.institution !== els.institution.value) return false;
    if (els.area.value && course.area !== els.area.value) return false;
    if (els.onlyWithGrade.checked && !lastPlacedGrade(course)) return false;
    const grade = lastPlacedGrade(course);
    if (minGrade > 0 && (typeof grade !== "number" || grade < minGrade)) return false;
    return true;
  });

  sortCourses();
  state.visible = 18;
  renderStats();
  renderCards();
  if (state.selectedId && !state.filtered.some((course) => course.id === state.selectedId)) {
    showResults({ keepHash: true });
    state.selectedId = null;
    renderDetail();
  }
}

function sortCourses() {
  const sorters = {
    demand: (a, b) => value(b.demandRatio) - value(a.demandRatio),
    lastGrade: (a, b) => value(lastPlacedGrade(b)) - value(lastPlacedGrade(a)),
    applicants: (a, b) => value(applicants(b)) - value(applicants(a)),
    vacancies: (a, b) => value(vacancies(b)) - value(vacancies(a)),
    occupancy: (a, b) => value(b.occupancyRate) - value(a.occupancyRate),
    name: (a, b) => (a.name || "").localeCompare(b.name || "", "pt"),
  };
  state.filtered.sort(sorters[els.sort.value] || sorters.demand);
}

function renderStats() {
  els.statCourses.textContent = fmt.format(state.filtered.length);
  els.statInstitutions.textContent = fmt.format(new Set(state.filtered.map((course) => course.institution)).size);
  els.statAvgLastGrade.textContent = averageLabel(state.filtered.map(lastPlacedGrade), "");
  els.statDemand.textContent = averageLabel(state.filtered.map((course) => course.demandRatio), "x");
}

function renderCards() {
  const visibleCourses = state.filtered.slice(0, state.visible);
  els.visibleRange.textContent = state.filtered.length
    ? `${fmt.format(Math.min(state.visible, state.filtered.length))} de ${fmt.format(state.filtered.length)}`
    : "0 resultados";

  if (!visibleCourses.length) {
    els.cards.innerHTML = `<div class="empty-state">Sem cursos para estes filtros.</div>`;
    els.loadMore.hidden = true;
    return;
  }

  els.cards.innerHTML = groupedCardsTemplate(visibleCourses);
  els.loadMore.hidden = state.visible >= state.filtered.length;

  document.querySelectorAll(".course-card").forEach((card) => {
    card.addEventListener("click", () => {
      openCourse(card.dataset.id);
    });
  });
}

function groupedCardsTemplate(courses) {
  const groups = new Map();
  courses.forEach((course) => {
    const area = course.area || "Área n/d";
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(course);
  });

  return [...groups.entries()]
    .map(
      ([area, areaCourses]) => `
        <section class="area-group" aria-label="${escapeAttr(areaLabel(area))}">
          <div class="area-group-head">
            <h3>${escapeHtml(areaLabel(area))}</h3>
            <span>${fmt.format(areaCourses.length)}</span>
          </div>
          ${areaCourses.map(cardTemplate).join("")}
        </section>
      `,
    )
    .join("");
}

function cardTemplate(course) {
  const active = course.id === state.selectedId ? " active" : "";
  return `
    <button class="course-card${active}" type="button" data-id="${escapeAttr(course.id)}">
      <div>
        <h3>${escapeHtml(course.name)}</h3>
        <p>${escapeHtml(course.institution)}</p>
        <p class="course-submeta">${escapeHtml(course.degree || "n/d")} · ${escapeHtml(course.teachingType || "n/d")}</p>
        <p class="course-area">${escapeHtml(areaLabel(course.area))}</p>
      </div>
      <span class="score-pill">${numberLabel(lastPlacedGrade(course), "")}</span>
      <div class="micro-metrics">
        <span><strong>${numberLabel(vacancies(course), "")}</strong> Vagas</span>
        <span><strong>${numberLabel(applicants(course), "")}</strong> Candidatos</span>
        <span><strong>${numberLabel(course.demandRatio, "x")}</strong> Procura/vaga</span>
      </div>
    </button>
  `;
}

function renderDetail() {
  const course = findCourse(state.selectedId);
  els.compareSelected.disabled = !course;
  if (!course) {
    els.detailsTitle.textContent = "Seleciona um curso";
    els.detailContent.className = "detail-content empty";
    els.detailContent.innerHTML = "<p>Escolhe um resultado para ver indicadores de candidatura e condições de acesso.</p>";
    return;
  }

  els.detailsTitle.textContent = "Curso selecionado";
  els.detailContent.className = "detail-content";
  els.detailContent.innerHTML = `
    <h3 class="detail-title">${escapeHtml(course.name)}</h3>
    <p class="detail-meta">${escapeHtml(course.institution)}<br>Código ${escapeHtml(course.id)} · ${escapeHtml(course.area || "Área n/d")}</p>
    <div class="detail-grid">
      ${metric("Vagas", numberLabel(vacancies(course), ""))}
      ${metric("Candidatos 2025 F1", numberLabel(applicants(course), ""))}
      ${metric("Procura/vaga", numberLabel(course.demandRatio, "x"))}
      ${metric("Último colocado", numberLabel(lastPlacedGrade(course), ""))}
    </div>
    ${accessDetails(course)}
    ${historyTable(course)}
    <p class="detail-meta">Fonte: <a href="${escapeAttr(course.source)}" target="_blank" rel="noreferrer">DGES Guia da Candidatura 2026</a></p>
  `;
}

function openCourse(id, options = {}) {
  const course = findCourse(id);
  if (!course) return;

  state.selectedId = course.id;
  renderCards();
  renderDetail();
  showCoursePage();

  if (!options.fromHash) {
    history.pushState(null, "", `#curso=${encodeURIComponent(course.id)}`);
  }
}

function showCoursePage() {
  els.filters.hidden = true;
  els.resultsArea.hidden = true;
  els.coursePage.hidden = false;
  renderCompare();
  requestAnimationFrame(() => {
    const top = window.scrollY + els.coursePage.getBoundingClientRect().top - 12;
    window.scrollTo(0, Math.max(0, top));
  });
}

function showResults(options = {}) {
  els.filters.hidden = false;
  els.resultsArea.hidden = false;
  els.coursePage.hidden = true;
  state.selectedId = null;
  renderCards();

  if (!options.keepHash && location.hash.startsWith("#curso=")) {
    history.pushState(null, "", location.pathname + location.search);
  }

  requestAnimationFrame(() => {
    const top = window.scrollY + els.resultsArea.getBoundingClientRect().top - 12;
    window.scrollTo(0, Math.max(0, top));
  });
}

function openCourseFromHash() {
  const hash = location.hash.trim();
  if (!hash.startsWith("#curso=")) {
    if (!els.coursePage.hidden) showResults({ keepHash: true });
    return;
  }

  const id = decodeURIComponent(hash.replace("#curso=", ""));
  openCourse(id, { fromHash: true });
}

function metric(label, valueText) {
  return `<div class="detail-metric"><span>${label}</span><strong>${valueText}</strong></div>`;
}

function accessDetails(course) {
  return `
    <section class="access-panel" aria-label="Provas de ingresso e fórmula de candidatura">
      <div>
        <h3 class="detail-section">Provas de ingresso</h3>
        ${admissionExamsTemplate(course)}
      </div>
      <div>
        <h3 class="detail-section">Fórmula de candidatura</h3>
        <div class="formula-card">
          <strong>${escapeHtml(formulaLabel(course))}</strong>
          <span>Mínimos: candidatura ${escapeHtml(String(course.applicationMinimum ?? "n/d"))} · provas ${escapeHtml(String(course.examMinimum ?? "n/d"))}</span>
        </div>
      </div>
    </section>
  `;
}

function admissionExamsTemplate(course) {
  const structure = admissionExamStructure(course);
  if (structure.type === "sets") {
    return `
      <p class="exam-help">Escolhe um dos conjuntos seguintes.</p>
      <div class="exam-combos">
        ${structure.groups
          .map((group, index) => `${index ? `<span class="combo-separator">OU</span>` : ""}${examGroupTemplate(group)}`)
          .join("")}
      </div>
    `;
  }

  if (structure.type === "choose") {
    return `
      <p class="exam-help">Escolhe ${structure.count} das seguintes provas.</p>
      <div class="exam-list">
        ${structure.exams.map(examPillTemplate).join("")}
      </div>
    `;
  }

  if (structure.type === "required") {
    return `
      <p class="exam-help">Provas exigidas em conjunto.</p>
      ${examGroupTemplate(structure.exams)}
    `;
  }

  return `<p class="detail-meta">${escapeHtml(course.admissionExams?.raw || "Informação não disponível na DGES.")}</p>`;
}

function admissionExamStructure(course) {
  const raw = course.admissionExams?.raw || "";
  const tokens = raw
    .split(" · ")
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) return { type: "empty" };

  if (tokens[0] === "Um dos seguintes conjuntos:") {
    const groups = [];
    let current = [];
    tokens.slice(1).forEach((token) => {
      if (normalize(token) === "ou") {
        if (current.length) groups.push(current);
        current = [];
        return;
      }
      const exam = examFromToken(token);
      if (exam) current.push(exam);
    });
    if (current.length) groups.push(current);
    return groups.length ? { type: "sets", groups } : { type: "empty" };
  }

  if (tokens[0] === "Duas das seguintes provas:") {
    const exams = tokens.slice(1).map(examFromToken).filter(Boolean);
    return exams.length ? { type: "choose", count: 2, exams } : { type: "empty" };
  }

  const exams = tokens.map(examFromToken).filter(Boolean);
  return exams.length ? { type: "required", exams } : { type: "empty" };
}

function examFromToken(token) {
  const match = token.match(/^(\d{2})\s+(.+)$/);
  return match ? { code: match[1], name: match[2] } : null;
}

function examGroupTemplate(exams) {
  return `
    <div class="exam-combo">
      ${exams.map((exam, index) => `${index ? `<span class="exam-operator">+</span>` : ""}${examPillTemplate(exam)}`).join("")}
    </div>
  `;
}

function examPillTemplate(exam) {
  return `
    <span class="exam-pill">
      <strong>${escapeHtml(exam.code)}</strong>
      ${escapeHtml(exam.name)}
    </span>
  `;
}

function formulaLabel(course) {
  if (typeof course.secondaryWeight === "number" && typeof course.examWeight === "number") {
    return `Nota = ${fmt.format(course.secondaryWeight)}% média do secundário + ${fmt.format(course.examWeight)}% provas de ingresso`;
  }
  return course.accessFormula?.raw || "Fórmula não disponível na DGES.";
}

function historyTable(course) {
  const allPhases = course.statistics?.phases || [];
  if (!allPhases.length) return "";

  const years = [...new Set(allPhases.map((phase) => phase.year).filter(Boolean))];
  const columns = years.flatMap((year) => [
    allPhases.find((phase) => phase.year === year && phase.phase === "1ª Fase") || { year, phase: "1ª Fase" },
    allPhases.find((phase) => phase.year === year && phase.phase === "2ª Fase") || { year, phase: "2ª Fase" },
  ]);
  const mobileYears = [...years].sort((a, b) => Number(b) - Number(a));

  return `
    <section class="history-panel" aria-labelledby="history-title">
      <div class="history-head">
        <div>
          <h3 id="history-title" class="detail-section">Histórico DGES</h3>
          <p>Evolução por ano e fase, com candidatos, colocados e médias.</p>
        </div>
      </div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th></th>
              ${years.map((year) => `<th colspan="2">${escapeHtml(year)}</th>`).join("")}
            </tr>
            <tr>
              <th></th>
              ${columns.map((phase) => `<th>${escapeHtml(phase.phase)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${historyRow("Vagas", columns, "vacancies", "strong")}
            ${historyGroup("Candidatos")}
            ${historyRow("Candidatos", columns, "applicants")}
            ${historyRow("do Sexo Feminino", columns, "applicantsFemale", "sub")}
            ${historyRow("do Sexo Masculino", columns, "applicantsMale", "sub")}
            ${historyRow("em 1.ª Opção", columns, "firstChoiceApplicants", "sub")}
            ${historyGroup("Colocados")}
            ${historyRow("Colocados", columns, "placed")}
            ${historyRow("do Sexo Feminino", columns, "placedFemale", "sub")}
            ${historyRow("do Sexo Masculino", columns, "placedMale", "sub")}
            ${historyRow("em 1.ª Opção", columns, "firstChoicePlaced", "sub")}
            ${historyGroup("Médias dos Colocados")}
            ${historyRow("Nota de Candidatura", columns, "averageAdmissionGrade")}
            ${historyRow("Provas de Ingresso", columns, "averageExamGrade")}
            ${historyRow("Média do Secundário", columns, "averageSecondaryGrade")}
            ${historyRow("Último colocado", columns, "lastPlacedGrade", "strong")}
          </tbody>
        </table>
      </div>
      <div class="history-mobile">
        ${mobileYears.map((year) => historyYearCard(year, columns)).join("")}
      </div>
    </section>
  `;
}

function historyGroup(label) {
  return `<tr class="history-group"><th colspan="99">${escapeHtml(label)}</th></tr>`;
}

function historyRow(label, phases, field, variant = "") {
  return `
    <tr class="${variant ? `is-${variant}` : ""}">
      <th>${escapeHtml(label)}</th>
      ${phases.map((phase) => `<td>${numberLabel(phase[field], "")}</td>`).join("")}
    </tr>
  `;
}

function historyYearCard(year, phases) {
  const yearPhases = phases
    .filter((phase) => phase.year === year)
    .sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase));

  return `
    <article class="history-card">
      <header>
        <span>${escapeHtml(year || "Ano n/d")}</span>
        <strong>${yearPhases.length} fases</strong>
      </header>
      <div class="history-phases">
        ${yearPhases.map(historyPhaseColumn).join("")}
      </div>
    </article>
  `;
}

function historyPhaseColumn(phase) {
  return `
    <section class="history-phase">
      <h4>${escapeHtml(phase.phase || "Fase n/d")}</h4>
      ${historyCardRow("Vagas", phase.vacancies, "strong")}
      ${historyCardRow("Candidatos", phase.applicants)}
      ${historyCardRow("Colocados", phase.placed)}
      ${historyCardRow("Último", phase.lastPlacedGrade, "strong")}
      ${historyCardRow("1.ª opção", phase.firstChoiceApplicants)}
      ${historyCardRow("Média", phase.averageAdmissionGrade)}
    </section>
  `;
}

function historyCardRow(label, raw, variant = "") {
  return `<p class="${variant ? `is-${variant}` : ""}"><span>${escapeHtml(label)}</span><strong>${numberLabel(raw, "")}</strong></p>`;
}

function phaseOrder(phase) {
  return phase === "1ª Fase" ? 1 : phase === "2ª Fase" ? 2 : 99;
}

function renderCompare() {
  const courses = state.compare.map(findCourse).filter(Boolean);
  if (!courses.length) {
    els.compareList.innerHTML = `<div class="empty-state">Adiciona até 3 cursos para comparar.</div>`;
    return;
  }

  els.compareList.innerHTML = courses
    .map(
      (course) => `
      <article class="compare-item">
        <h4>${escapeHtml(course.name)}</h4>
        <p>${escapeHtml(course.institution)}</p>
        <div class="compare-metrics">
          <span><strong>${numberLabel(course.demandRatio, "x")}</strong> Procura</span>
          <span><strong>${numberLabel(applicants(course), "")}</strong> Candidatos</span>
          <span><strong>${numberLabel(lastPlacedGrade(course), "")}</strong> Último</span>
        </div>
      </article>
    `,
    )
    .join("");
}

function findCourse(id) {
  return state.courses.find((course) => course.id === id);
}

function applicants(course) {
  return course?.latest?.applicants ?? null;
}

function placed(course) {
  return course?.latest?.placed ?? null;
}

function vacancies(course) {
  return course?.vacancies2026 ?? course?.latest?.vacancies ?? null;
}

function lastPlacedGrade(course) {
  return course?.latest?.lastPlacedGrade ?? null;
}

function areaLabel(area) {
  return area || "Área n/d";
}

function averageLabel(values, suffix) {
  const nums = values.filter((value) => typeof value === "number");
  if (!nums.length) return "-";
  return `${fmt.format(nums.reduce((sum, value) => sum + value, 0) / nums.length)}${suffix}`;
}

function numberLabel(raw, suffix) {
  if (typeof raw === "string" && raw.trim()) return raw;
  return typeof raw === "number" ? `${fmt.format(raw)}${suffix}` : "n/d";
}

function value(raw) {
  return typeof raw === "number" ? raw : -1;
}

function normalize(valueText) {
  return String(valueText || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function escapeHtml(valueText) {
  return String(valueText ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(valueText) {
  return escapeHtml(valueText).replace(/'/g, "&#039;");
}
