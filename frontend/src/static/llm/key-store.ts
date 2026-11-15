// Chaves de API dos provedores de LLM no modo estático. Como no QualiLab, a
// chave é do coordenador: fica só no navegador dele (em memória, ou no
// localStorage se ele pedir) e nunca vai para o banco nem para servidor algum.
// Sai do navegador apenas na chamada direta ao provedor.

export type ProviderId = "google_genai" | "openai" | "anthropic";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  google_genai: "Google (Gemini)",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
};

export const PROVIDER_KEY_HELP: Record<ProviderId, string> = {
  google_genai: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};

const STORAGE_PREFIX = "dataframeit:llm-key:";
const memory = new Map<ProviderId, string>();

export function isProviderId(value: unknown): value is ProviderId {
  return value === "google_genai" || value === "openai" || value === "anthropic";
}

export function readStoredKey(provider: ProviderId): string | null {
  const inMemory = memory.get(provider);
  if (inMemory) return inMemory;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + provider);
  } catch {
    return null;
  }
}

export function storeKey(provider: ProviderId, key: string, remember: boolean): void {
  memory.set(provider, key);
  try {
    if (remember) window.localStorage.setItem(STORAGE_PREFIX + provider, key);
    else window.localStorage.removeItem(STORAGE_PREFIX + provider);
  } catch {
    // Armazenamento bloqueado: a chave vale só nesta aba.
  }
}

export function forgetKey(provider: ProviderId): void {
  memory.delete(provider);
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + provider);
  } catch {
    // nada a remover
  }
}

export function allKnownKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const provider of Object.keys(PROVIDER_LABELS) as ProviderId[]) {
    const key = readStoredKey(provider);
    if (key) keys[provider] = key;
  }
  return keys;
}

// ---- pedido de chave à interface (ProviderKeyDialog) ----
type Pending = { provider: ProviderId; resolve: (key: string | null) => void };
let pending: Pending | null = null;
const listeners = new Set<() => void>();

export function subscribeKeyRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentKeyRequest(): ProviderId | null {
  return pending?.provider ?? null;
}

export function answerKeyRequest(key: string | null, remember = false): void {
  const current = pending;
  if (!current) return;
  pending = null;
  if (key) storeKey(current.provider, key, remember);
  for (const listener of listeners) listener();
  current.resolve(key);
}

/** Devolve a chave conhecida ou pede ao coordenador (null se ele cancelar). */
export function ensureProviderKey(provider: ProviderId): Promise<string | null> {
  const known = readStoredKey(provider);
  if (known) return Promise.resolve(known);
  if (pending) pending.resolve(null);
  return new Promise((resolve) => {
    pending = { provider, resolve };
    for (const listener of listeners) listener();
  });
}
