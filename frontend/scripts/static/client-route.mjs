// Fronteira servidor/cliente das pages e layouts de `src/app` no modo estático.
//
// O `RouteView` chama pages e layouts de servidor como funções (inclusive as
// síncronas, que podem devolver Server Components `async` a resolver). Um
// módulo com `"use client"` é Client Component: chamá-lo como função roda os
// hooks fora da renderização do React (erro #321). Este transform marca esses
// módulos com `__clientComponent`, e o `RouteView` os entrega ao React como
// elemento — a mesma fronteira que a diretiva traça no App Router.

export const CLIENT_COMPONENT_EXPORT = "__clientComponent";

const ROUTE_FILE = /[\\/]src[\\/]app[\\/](?:.*[\\/])?(?:page|layout)\.tsx$/;
// Diretiva no topo do módulo: só comentários e espaços antes dela.
const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

/** Código transformado, ou `null` quando o módulo não é page/layout de cliente. */
export function markClientRoute(code, id) {
  if (!ROUTE_FILE.test(id) || !USE_CLIENT.test(code)) return null;
  return `${code}\nexport const ${CLIENT_COMPONENT_EXPORT} = true;\n`;
}
