// `cache` do React na Edge Function: memória por requisição, guardada no
// contexto da chamada (nunca compartilhada entre usuários do mesmo isolate).
import { currentContext } from "@/static/edge/context";

export function cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    const { memo } = currentContext();
    let entries = memo.get(fn) as Map<string, R> | undefined;
    if (!entries) {
      entries = new Map();
      memo.set(fn, entries as Map<string, unknown>);
    }
    let key: string;
    try {
      key = JSON.stringify(args);
    } catch {
      return fn(...args);
    }
    if (entries.has(key)) return entries.get(key) as R;
    const value = fn(...args);
    entries.set(key, value);
    return value;
  };
}
