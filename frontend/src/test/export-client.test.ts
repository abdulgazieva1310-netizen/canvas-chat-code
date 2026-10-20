import { afterEach, expect, it, vi } from "vitest";
import { Api } from "@/lib/api/client";
import { saveAuthorization } from "@/lib/api/session";
afterEach(() => { vi.unstubAllGlobals(); saveAuthorization(null); });
it("downloads an authenticated Markdown blob from the encoded report endpoint", async () => {
  saveAuthorization("Bearer test-session");
  const fetch = vi.fn().mockResolvedValue(new Response("# Пример\n```python\nprint(1)\n```", {headers:{"Content-Type":"text/markdown"}}));
  vi.stubGlobal("fetch",fetch);
  const blob = await Api.exportReport("a/b");
  expect(await blob.text()).toContain("Пример");
  expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/interviews/a%2Fb/report/export",expect.objectContaining({
    credentials:"include",headers:expect.objectContaining({Authorization:"Bearer test-session"})}));
});
it("preserves download errors instead of downloading an error document", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response('{"message":"End the interview first."}',{status:409})));
  await expect(Api.exportReport("active")).rejects.toMatchObject({status:409,message:"End the interview first."});
});
it("downloads only the current account archive with session credentials", async () => {
  saveAuthorization("Bearer owner-session");
  const fetch=vi.fn().mockResolvedValue(new Response('{"schemaVersion":1}',{headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  const blob=await Api.exportAccount();
  expect(await blob.text()).toContain('"schemaVersion":1');
  expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/auth/me/export",expect.objectContaining({credentials:"include",headers:expect.objectContaining({Authorization:"Bearer owner-session"})}));
});
