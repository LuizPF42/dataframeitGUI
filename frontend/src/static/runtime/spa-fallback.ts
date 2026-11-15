// Rotas profundas no GitHub Pages. O Pages só conhece `index.html`; um acesso
// direto a `/projects/123/code` cai no `404.html`, que é cópia do `index.html`
// e portanto carrega o mesmo app com a URL intacta. Nada a reescrever na
// maioria dos casos — este hook existe para o formato alternativo
// `/?p=/projects/123/code`, usado por quem publica atrás de um servidor que não
// serve o 404.html.

import { basePath } from "@/static/runtime/base-path";

export function restoreRedirectedPath(): void {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("p");
  if (!target || !target.startsWith("/") || target.startsWith("//")) return;
  params.delete("p");
  const rest = params.toString();
  window.history.replaceState(null, "", `${basePath}${target}${rest ? `?${rest}` : ""}${window.location.hash}`);
}
