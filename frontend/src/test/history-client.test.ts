import { afterEach, expect, it, vi } from "vitest";
import { Api } from "@/lib/api/client";

afterEach(() => vi.unstubAllGlobals());

it("keeps all history available to array consumers across response pages", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "a" }], total: 2, page: 1, pageSize: 1 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "b" }], total: 2, page: 2, pageSize: 1 })));
  vi.stubGlobal("fetch", fetch);
  expect(await Api.getHistory()).toEqual([{ id: "a" }, { id: "b" }]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "http://localhost:8000/api/interviews", "http://localhost:8000/api/interviews?page=2&pageSize=1",
  ]);
});

it("returns an empty array for an empty history envelope", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }))));
  expect(await Api.getHistory()).toEqual([]);
});
