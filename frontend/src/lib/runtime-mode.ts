// Modo de execução do build. No modo hospedado (Next + Fly) é `false`; o build
// estático (GitHub Pages) troca este módulo por `src/static/runtime-mode.ts`.
// Use só onde a diferença é de infraestrutura, não de regra de produto.
export const STATIC_MODE = false;
