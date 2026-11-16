import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5 } from "@/lib/hash";

// `documents.content_hash` é gravado pelos dois modos (Node no hospedado,
// navegador no estático) e usado para achar duplicatas na importação: o md5 em
// JS precisa bater byte a byte com o do Node, inclusive com acentos e emoji.
describe("md5 do conteúdo de documento", () => {
  it.each([
    "",
    "texto simples",
    "Decisão: o tribunal concedeu o medicamento à paciente — art. 196 da CF.",
    "linha 1\r\nlinha 2\n\ttab",
    "emoji 🧬 e CJK 漢字",
  ])("bate com o crypto do Node: %j", (text) => {
    expect(md5(text)).toBe(createHash("md5").update(text).digest("hex"));
  });
});
