export const interviewerAvatars = [
  { id: "classic", name: "Classic", swatch: "#655a83" },
  { id: "sage", name: "Sage", swatch: "#426b64" },
  { id: "rose", name: "Rose", swatch: "#9a526b" },
] as const;

export type InterviewerAvatarId = (typeof interviewerAvatars)[number]["id"];

export function getInterviewerAvatar(saved?: string | null): InterviewerAvatarId {
  return interviewerAvatars.find((avatar) => avatar.id === saved)?.id ?? "classic";
}
