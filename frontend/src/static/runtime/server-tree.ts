// Executa no navegador os Server Components assíncronos (pages e layouts) da
// árvore `src/app`. No modo hospedado o Next os roda no servidor e envia o
// resultado; aqui eles são funções `async` comuns cujo retorno é JSX feito de
// Client Components. O que muda é só ONDE rodam: as consultas são as mesmas e
// continuam passando pela RLS, agora com o JWT do Supabase Auth do usuário.
//
// Um componente assíncrono aninhado no JSX devolvido também é resolvido aqui,
// porque o React no cliente não renderiza componentes `async`.

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

const AsyncFunction = (async () => {}).constructor;

function isAsyncComponent(type: unknown): type is (props: unknown) => Promise<ReactNode> {
  return typeof type === "function" && type instanceof AsyncFunction;
}

export async function resolveTree(node: unknown): Promise<ReactNode> {
  if (node === null || node === undefined || typeof node !== "object") {
    return node as ReactNode;
  }
  if (node instanceof Promise) return resolveTree(await node);
  if (Array.isArray(node)) return Promise.all(node.map(resolveTree));
  if (!isValidElement(node)) return node as ReactNode;

  const element = node as ReactElement<Record<string, unknown>>;
  if (isAsyncComponent(element.type)) {
    return resolveTree(await element.type(element.props));
  }

  const updates: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(element.props ?? {})) {
    if (key === "children" || isValidElement(value)) {
      const resolved = await resolveTree(value);
      if (resolved !== value) {
        updates[key] = resolved;
        changed = true;
      }
    }
  }
  return changed ? cloneElement(element, updates) : element;
}

/** Chama um Server Component (page ou layout) e resolve o que ele devolver. */
export async function renderServerComponent(
  component: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
): Promise<ReactNode> {
  return resolveTree(await component(props));
}
