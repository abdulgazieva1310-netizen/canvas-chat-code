export function validateAuthSearch(search: Record<string, unknown>) {
  const redirect = search["redirect"];
  // Only return to local app routes, never an external URL or another auth page.
  const path = typeof redirect === "string" ? redirect.split(/[?#]/)[0] : "";
  return {
    redirect:
      typeof redirect === "string" &&
      ["/", "/setup", "/ready", "/interview", "/report"].includes(path ?? "")
        ? redirect
        : "/",
  };
}
