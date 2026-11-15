// Ambiente Python do navegador, fixado. Medido em Pyodide 314.0.7 (Python
// 3.14.2): com estas versões e `micropip.install(..., deps=False)` os três
// provedores da GUI (Google, OpenAI, Anthropic) importam. A instalação com
// resolução de dependências falha por pinos incompatíveis com os pacotes do
// próprio Pyodide (uuid-utils, tenacity), por isso a lista é explícita.

const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Pacotes compilados que vêm do repositório do próprio Pyodide. */
export const PYODIDE_PACKAGES = [
  "micropip",
  "pandas",
  "pydantic",
  "httpx",
  "anyio",
  "sniffio",
  "tqdm",
  "typing-extensions",
  "jiter",
  "tiktoken",
  "orjson",
  "pyyaml",
  "packaging",
  "jsonpatch",
  "requests",
  "cryptography",
  "cachetools",
  "distro",
  "regex",
  "xxhash",
  "zstandard",
  "openai",
];

/** Pacotes puro-Python do PyPI, sem resolução de dependências. */
export const PYPI_PACKAGES = [
  "anthropic==2.8.0",
  "docstring-parser==0.18.0",
  "filetype==1.2.0",
  "google-auth==2.62.2",
  "google-genai==3.3.0",
  "httpx2-jsfetch==1.0",
  "httpx2==2.16.0",
  "langchain-anthropic==1.7.10",
  "langchain-core==1.8.1",
  "langchain-google-genai==4.5.0",
  "langchain-openai==1.8.0",
  "langchain-protocol==0.0.21",
  "langchain==1.5.0",
  "langsmith==0.14.17",
  "opentelemetry-api==1.45.2",
  "requests-toolbelt==1.0.0",
  "tenacity==9.2.1",
  "uuid-utils==1.2.0",
  "websockets==17.4",
];

/**
 * O dataframeit precisa do modo assíncrono (`adataframeit`). Enquanto a versão
 * com ele não estiver no PyPI, o build pode apontar para uma wheel publicada
 * junto do site (VITE_DATAFRAMEIT_WHEEL, ex.: "py/dataframeit-0.11.1-py3-none-any.whl").
 */
export function dataframeitRequirement(siteBaseUrl: string): string {
  const wheel = import.meta.env.VITE_DATAFRAMEIT_WHEEL;
  if (wheel) return new URL(wheel, siteBaseUrl).toString();
  return "dataframeit>=0.12";
}
