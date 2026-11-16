// Prefixo de publicação (ex.: "/dataframeitGUI" em usuario.github.io/dataframeitGUI/).
// Vem do `base` do Vite; sem barra final, vazio na raiz do domínio.
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Raiz do site publicado, ex.: https://grupo.github.io/dataframeitGUI */
export function siteRoot(): string {
  return `${window.location.origin}${basePath}`;
}
