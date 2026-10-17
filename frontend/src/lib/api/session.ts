// Browser-scoped storage avoids sharing credentials between SSR requests.
const sessionKey = "interview-mirror.authorization";

export function getAuthorization(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(sessionKey);
  } catch {
    return null;
  }
}

export function saveAuthorization(value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(sessionKey, value);
    else window.sessionStorage.removeItem(sessionKey);
  } catch {
    // HttpOnly cookie authentication still works if browser storage is disabled.
  }
}
