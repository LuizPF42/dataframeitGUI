import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findPrivilegedActions } from "../../../scripts/static/privileged-actions.mjs";

describe("divisão das actions entre navegador e Edge Function", () => {
  // Montar o grafo de imports (esbuild sobre src/actions) é o mesmo trabalho
  // do build, e fica no `beforeAll`, fora do orçamento de CPU por teste
  // (src/test-utils/cpu-budget.ts): o teste confere só o resultado.
  let privileged: Record<string, string[]>;
  beforeAll(async () => {
    privileged = (await findPrivilegedActions(path.resolve(process.cwd(), "src"))) as Record<
      string,
      string[]
    >;
  }, 30_000);

  it("manda para a Edge Function só os módulos que alcançam a service role", () => {
    // Usam a service role hoje (gestão de equipe, efeitos automáticos de
    // comparação/auto-revisão e materialização de assignments para terceiros).
    for (const moduleName of ["members", "field-reviews", "comparisons", "equivalences", "responses"]) {
      expect(Object.keys(privileged)).toContain(moduleName);
    }
    // Rodam no navegador com o JWT do usuário: a RLS é a fronteira.
    for (const moduleName of ["projects", "documents", "schema", "llm", "assignments", "stats", "export"]) {
      expect(Object.keys(privileged)).not.toContain(moduleName);
    }
    expect(privileged.members).toContain("addMember");
  });
});
