import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderServerComponent, resolveTree } from "@/static/runtime/server-tree";

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
});
