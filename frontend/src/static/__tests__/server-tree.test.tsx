import { isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { markClientRoute } from "../../../scripts/static/client-route.mjs";
import { renderRouteModule, renderServerComponent, resolveTree } from "@/static/runtime/server-tree";

function ClientBox({ children, aside }: { children?: ReactNode; aside?: ReactNode }) {
  return (
    <div>
      {aside}
      {children}
    </div>
  );
}

async function AsyncLeaf({ label }: { label: string }) {
  await Promise.resolve();
  return <span>{label}</span>;
}

async function AsyncParent() {
  await Promise.resolve();
  return (
    <ClientBox aside={<AsyncLeaf label="lado" />}>
      <AsyncLeaf label="filho" />
      texto
    </ClientBox>
  );
}

function props(node: ReactNode): Record<string, unknown> {
  if (!isValidElement(node)) throw new Error("esperava elemento");
  return (node as ReactElement<Record<string, unknown>>).props;
}

describe("resolução de Server Components no navegador", () => {
  it("executa componentes assíncronos aninhados, inclusive em props que não são children", async () => {
    const tree = await renderServerComponent(AsyncParent, {});
    expect(isValidElement(tree) && tree.type).toBe(ClientBox);
    const box = props(tree);
    expect(props(box.aside as ReactNode).children).toBe("lado");
    const children = box.children as ReactNode[];
    expect(props(children[0]).children).toBe("filho");
    expect(children[1]).toBe("texto");
  });

  it("não chama componentes síncronos (Client Components)", async () => {
    let calls = 0;
    function Counted() {
      calls += 1;
      return null;
    }
    const element = <Counted />;
    expect(await resolveTree(element)).toBe(element);
    expect(calls).toBe(0);
  });

  it("propaga a exceção do componente (redirect/notFound/erro)", async () => {
    async function Failing(): Promise<ReactNode> {
      throw new Error("falhou");
    }
    await expect(renderServerComponent(Failing, {})).rejects.toThrow("falhou");
  });

  it("entrega page \"use client\" ao React como elemento, sem chamar os hooks fora da renderização", async () => {
    // Regressão: /projects/new (useActionState) quebrava com o erro #321 do React.
    const rendered = vi.fn();
    function ClientPage() {
      rendered();
      useState(0); // fora da renderização, lançaria "Invalid hook call"
      return null;
    }
    const tree = await renderRouteModule({ default: ClientPage, __clientComponent: true }, { params: Promise.resolve({}) });
    expect(rendered).not.toHaveBeenCalled();
    expect(isValidElement(tree) && tree.type).toBe(ClientPage);
  });

  it("segue chamando layouts e pages de servidor, inclusive os síncronos", async () => {
    function SyncServerLayout() {
      return <ClientBox aside={<AsyncLeaf label="nav" />} />;
    }
    const tree = await renderRouteModule({ default: SyncServerLayout }, {});
    expect(props(props(tree).aside as ReactNode).children).toBe("nav");
  });
});

describe("marcação de pages e layouts de cliente no build", () => {
  const page = "/repo/frontend/src/app/(app)/projects/new/page.tsx";

  it("marca page/layout que começa com a diretiva use client", () => {
    expect(markClientRoute('"use client";\nexport default function P() {}', page)).toContain(
      "export const __clientComponent = true;",
    );
    expect(markClientRoute("// comentário\n'use client';\n", String.raw`C:\r\frontend\src\app\x\layout.tsx`)).not.toBeNull();
  });

  it("não marca Server Components nem arquivos fora de page/layout", () => {
    expect(markClientRoute("export default async function P() {}", page)).toBeNull();
    expect(markClientRoute('const s = "use client";', page)).toBeNull();
    expect(markClientRoute('"use client";', "/repo/frontend/src/components/X.tsx")).toBeNull();
  });
});
