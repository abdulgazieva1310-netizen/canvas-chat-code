import type { CodingLanguage } from "@/components/CodeEditor";

const prefix = "interview-mirror.answer-draft.v1:";
const expiryMs = 24 * 60 * 60 * 1000;
const maxBytes = 64 * 1024;
const languages = new Set<CodingLanguage>(["python", "java", "cpp", "javascript", "typescript"]);

export interface AnswerDraft {
  text: string;
  codingLanguage: CodingLanguage | null;
  updatedAt: number;
}

export type DraftStorageResult = "saved" | "cleared" | "unavailable" | "too-large";

function keyFor(ownerId: string, interviewId: string, questionId: string) {
  return `${prefix}${encodeURIComponent(ownerId)}:${encodeURIComponent(interviewId)}:${encodeURIComponent(questionId)}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadAnswerDraft(ownerId: string, interviewId: string, questionId: string) {
  const store = storage();
  if (!store) return { draft: null, available: false };
  const key = keyFor(ownerId, interviewId, questionId);
  try {
    const raw = store.getItem(key);
    if (!raw) return { draft: null, available: true };
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("text" in value) ||
      typeof value.text !== "string" ||
      !value.text ||
      !("updatedAt" in value) ||
      typeof value.updatedAt !== "number" ||
      Date.now() - value.updatedAt > expiryMs ||
      value.updatedAt > Date.now() + 60_000
    ) {
      store.removeItem(key);
      return { draft: null, available: true };
    }
    const codingLanguage =
      "codingLanguage" in value && languages.has(value.codingLanguage as CodingLanguage)
        ? (value.codingLanguage as CodingLanguage)
        : null;
    return {
      draft: { text: value.text, codingLanguage, updatedAt: value.updatedAt } satisfies AnswerDraft,
      available: true,
    };
  } catch {
    return { draft: null, available: false };
  }
}

export function saveAnswerDraft(
  ownerId: string,
  interviewId: string,
  questionId: string,
  text: string,
  codingLanguage: CodingLanguage | null,
): DraftStorageResult {
  const store = storage();
  if (!store) return "unavailable";
  const key = keyFor(ownerId, interviewId, questionId);
  try {
    if (!text) {
      store.removeItem(key);
      return "cleared";
    }
    if (new Blob([text]).size > maxBytes) {
      store.removeItem(key);
      return "too-large";
    }
    store.setItem(
      key,
      JSON.stringify({ text, codingLanguage, updatedAt: Date.now() } satisfies AnswerDraft),
    );
    return "saved";
  } catch {
    try {
      store.removeItem(key);
    } catch {
      // A blocked or full store must not prevent typing or submitting.
    }
    return "unavailable";
  }
}

export function clearAnswerDraft(ownerId: string, interviewId: string, questionId: string) {
  try {
    storage()?.removeItem(keyFor(ownerId, interviewId, questionId));
  } catch {
    // Draft cleanup is best effort when browser storage is disabled.
  }
}

export function clearInterviewAnswerDrafts(interviewId: string, ownerId?: string) {
  const store = storage();
  if (!store) return;
  const interviewPart = `:${encodeURIComponent(interviewId)}:`;
  const ownerPart = ownerId ? `${prefix}${encodeURIComponent(ownerId)}:` : prefix;
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => !!key && key.startsWith(ownerPart) && key.includes(interviewPart),
    );
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Draft cleanup is best effort when browser storage is disabled.
  }
}

export function clearAllAnswerDrafts() {
  const store = storage();
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => !!key && key.startsWith(prefix),
    );
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Draft cleanup is best effort when browser storage is disabled.
  }
}
