import { afterEach, describe, expect, it, vi } from "vitest";
import { beginRequest, cache, invalidateRequestCache } from "@/static/runtime/request-cache";

afterEach(() => {
  vi.useRealTimers();
});

describe("cache por resolução de rota", () => {
  it("deduplica chamadas com os mesmos argumentos dentro da época", async () => {
    const fn = vi.fn(async (id: string) => `v-${id}`);
    const cached = cache(fn);
    beginRequest();
    const [a, b, c] = await Promise.all([cached("1"), cached("1"), cached("2")]);
    expect([a, b, c]).toEqual(["v-1", "v-1", "v-2"]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("recalcula depois de revalidação ou de nova navegação", async () => {
    const fn = vi.fn(async () => Math.random());
    const cached = cache(fn);
    beginRequest();
    await cached();
    invalidateRequestCache();
    await cached();
    beginRequest();
    await cached();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("não memoriza falha", async () => {
    let attempt = 0;
    const cached = cache(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("rede");
      return "ok";
    });
    beginRequest();
    await expect(cached()).rejects.toThrow("rede");
    await expect(cached()).resolves.toBe("ok");
  });

  it("expira por tempo dentro da mesma época", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => 1);
    const cached = cache(fn);
    beginRequest();
    await cached();
    vi.advanceTimersByTime(31_000);
    await cached();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
