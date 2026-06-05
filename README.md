# InfoCursosPT

Protótipo de uma experiência moderna para estudantes que estão a escolher cursos do
ensino superior em Portugal, usando o Guia da Candidatura da DGES.

## Correr localmente

```bash
npm start
```

Depois abre `http://localhost:5173`.

## Atualizar dados

O JSON principal está em `public/data/dges-courses.json` e é gerado a partir do
índice e das páginas de detalhe da DGES:

https://www.dges.gov.pt/guias/indcurso.asp

Para regenerar o JSON consumido pelo site:

```bash
npm run data
```

O repositório também inclui uma GitHub Action que regenera os dados às 06:00 UTC:
diariamente de junho a setembro e semanalmente, à segunda-feira, no resto do ano.
A action limpa primeiro a cache local da DGES. Se o JSON mudar, cria automaticamente
um commit com os dados atualizados.

## O que a interface inclui

- Pesquisa por curso, instituição ou código.
- Filtros por concurso, tipo de ensino, grau, instituição e nota mínima do último colocado.
- Ordenação por procura/vaga, nota do último colocado, candidatos, vagas, ocupação ou nome.
- Painel de detalhe com vagas 2026, candidatos, colocados, último colocado,
  condições de acesso e evolução da nota do último colocado.
- Comparação rápida de até 3 cursos.
