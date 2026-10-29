import { getInterviewerAppearance } from "@/lib/interviewer-avatar";

/** Local illustration also available when WebGL or the 3D module cannot load. */
export function InterviewerPortrait({ avatarId }: { avatarId?: string | null }) {
  const appearance = getInterviewerAppearance(avatarId);
  return (
    <span
      role="img"
      aria-label={`${appearance.name} interviewer`}
      className="mx-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: appearance.swatch }}
    >
      <span className="relative h-9 w-7 rounded-[45%] bg-[#d9a982]">
        <span className="absolute -top-1 left-0 h-3 w-7 rounded-t-full bg-[#302846]" />
        <span className="absolute left-1 top-4 h-1 w-1 rounded-full bg-[#302846]" />
        <span className="absolute right-1 top-4 h-1 w-1 rounded-full bg-[#302846]" />
      </span>
    </span>
  );
}
