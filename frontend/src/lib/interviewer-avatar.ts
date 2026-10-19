export const interviewerAvatars = [
  { id: "classic", name: "Classic", swatch: "#655a83" },
  { id: "sage", name: "Sage", swatch: "#426b64" },
  { id: "rose", name: "Rose", swatch: "#9a526b" },
] as const;

export type InterviewerAvatarId = (typeof interviewerAvatars)[number]["id"];

const storageKey = "interview-mirror-avatar";

export function getInterviewerAvatar(): InterviewerAvatarId {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return interviewerAvatars.find((avatar) => avatar.id === saved)?.id ?? "classic";
  } catch {
    return "classic";
  }
}

export function setInterviewerAvatar(id: InterviewerAvatarId): void {
  try {
    window.localStorage.setItem(storageKey, id);
  } catch {
    // A storage restriction should not prevent the interview from continuing.
  }
}
