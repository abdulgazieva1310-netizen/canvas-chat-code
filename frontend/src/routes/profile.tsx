import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { DownloadButton } from "@/components/DownloadButton";
import { DeleteAccount } from "@/components/DeleteAccount";
import { Api } from "@/lib/api/client";
import { targetRoles, type Level, type Role, type User } from "@/lib/api/types";
import {
  interviewerAvatars,
  type InterviewerAvatarId,
} from "@/lib/interviewer-avatar";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile Settings — Interview Mirror" }] }),
  component: Profile,
});

function Profile() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: Api.getProfile, retry: false });
  return (
    <AppShell>
      <h1 className="text-4xl">Profile Settings</h1>
      {profile.isPending && (
        <p role="status" className="mt-6">
          Loading profile…
        </p>
      )}
      {profile.error && (
        <div className="mt-6">
          <p role="alert">{profile.error.message}</p>
          <button className="btn btn-ghost mt-3" onClick={() => void profile.refetch()}>
            Retry
          </button>
        </div>
      )}
      {profile.data && <>
        <ProfileForm key={profile.data.id} user={profile.data} />
        <section className="card-surface mt-6 max-w-xl p-7" aria-label="Account data export">
          <h2 className="text-xl">Download your account data</h2>
          <p>Download a versioned JSON copy of your profile, interviews, feedback and study notes. Media metadata is included; recording files are excluded. End active Real Interviews first. Archives over 10 MiB cannot be downloaded here.</p>
          <DownloadButton label="Download account archive" filename="interview-mirror-account.json" load={Api.exportAccount} />
        </section>
        <DeleteAccount />
      </>}
    </AppShell>
  );
}

function ProfileForm({ user }: { user: User }) {
  const client = useQueryClient();
  const [name, setName] = useState(user.name);
  const [targetRole, setTargetRole] = useState<Role>(user.targetRole);
  const [level, setLevel] = useState<Level>(user.level);
  const [preferredLanguage, setPreferredLanguage] = useState(user.preferredLanguage);
  const [avatar, setAvatar] = useState<InterviewerAvatarId>(user.interviewerAvatar ?? "classic");
  const [voiceName, setVoiceName] = useState(user.interviewerVoiceName ?? "");
  const [voiceLang, setVoiceLang] = useState(user.interviewerVoiceLang ?? "");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  useEffect(() => {
    const synthesis = window.speechSynthesis;
    const refresh = () => {
      setVoices(synthesis?.getVoices?.() ?? []);
      setVoicesLoaded(true);
    };
    refresh();
    synthesis?.addEventListener?.("voiceschanged", refresh);
    return () => synthesis?.removeEventListener?.("voiceschanged", refresh);
  }, []);
  const selectedVoice = voices.find((voice) => voice.name === voiceName && voice.lang === voiceLang);
  const save = useMutation({
    mutationFn: () =>
      Api.updateProfile({
        name: name.trim(),
        targetRole,
        level,
        preferredLanguage: preferredLanguage.trim(),
        interviewerAvatar: avatar,
        interviewerVoiceName: voiceName || null,
        interviewerVoiceLang: voiceName ? voiceLang : null,
      }),
    onSuccess: (updated) => {
      client.setQueryData(["profile"], updated);
      setName(updated.name);
      setTargetRole(updated.targetRole);
      setLevel(updated.level);
      setPreferredLanguage(updated.preferredLanguage);
      setAvatar(updated.interviewerAvatar ?? "classic");
      setVoiceName(updated.interviewerVoiceName ?? "");
      setVoiceLang(updated.interviewerVoiceLang ?? "");
    },
  });
  return (
    <form
      className="card-surface mt-8 max-w-xl space-y-5 p-7"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && preferredLanguage.trim() && !save.isPending) save.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{user.email}</p>
      <label className="block">
        Name
        <input
          required
          autoComplete="name"
          value={name}
          disabled={save.isPending}
          onChange={(event) => {
            save.reset();
            setName(event.target.value);
          }}
          className="mt-2 w-full rounded-lg border bg-background p-3"
        />
      </label>
      <label className="block">
        Target role
        <select
          value={targetRole}
          disabled={save.isPending}
          onChange={(event) => {
            save.reset();
            setTargetRole(event.target.value as Role);
          }}
          className="mt-2 w-full rounded-lg border bg-background p-3"
        >
          {targetRoles.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </label>
      <label className="block">
        Level
        <select
          value={level}
          disabled={save.isPending}
          onChange={(event) => {
            save.reset();
            setLevel(event.target.value as Level);
          }}
          className="mt-2 w-full rounded-lg border bg-background p-3"
        >
          {["Junior", "Middle", "Senior"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="block">
        Preferred language
        <input
          required
          maxLength={80}
          value={preferredLanguage}
          disabled={save.isPending}
          aria-describedby="language-note"
          onChange={(event) => {
            save.reset();
            setPreferredLanguage(event.target.value);
          }}
          className="mt-2 w-full rounded-lg border bg-background p-3"
        />
      </label>
      <p id="language-note" className="text-sm text-muted-foreground">
        This profile preference is saved for future sessions. Choose English or Russian for each
        interview in the setup screen; support for other interview languages is not available yet.
      </p>
      <fieldset className="space-y-3 border-t pt-5">
        <legend className="font-semibold">Interviewer appearance</legend>
        <p className="text-sm text-muted-foreground">
          Choose the illustrated interviewer used in compatible sessions. This preference is saved
          to your profile and works with the avatar hidden.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {interviewerAvatars.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`rounded-lg border p-3 text-center ${avatar === option.id ? "border-primary ring-2 ring-primary" : "border-border"}`}
              aria-pressed={avatar === option.id}
              onClick={() => {
                const next = option.id as InterviewerAvatarId;
                setAvatar(next);
                save.reset();
              }}
            >
              <span
                className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ backgroundColor: option.swatch }}
              >
                <span className="relative h-9 w-7 rounded-[45%] bg-[#d9a982]">
                  <span className="absolute -top-1 left-0 h-3 w-7 rounded-t-full bg-[#302846]" />
                  <span className="absolute left-1 top-4 h-1 w-1 rounded-full bg-[#302846]" />
                  <span className="absolute right-1 top-4 h-1 w-1 rounded-full bg-[#302846]" />
                </span>
              </span>
              {option.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Selected appearance: {interviewerAvatars.find((item) => item.id === avatar)?.name ?? "Classic"}
        </p>
      </fieldset>
      <fieldset className="space-y-3 border-t pt-5">
        <legend className="font-semibold">Interviewer voice</legend>
        <p className="text-sm text-muted-foreground">
          Voices come from this browser and device. Your selection syncs with your profile; if it is
          unavailable elsewhere, the interview uses a matching system voice or text.
        </p>
        <label className="block">
          Voice
          <select
            value={voiceName ? `${voiceLang}\u0000${voiceName}` : ""}
            disabled={save.isPending}
            onChange={(event) => {
              const voice = voices.find((item) => `${item.lang}\u0000${item.name}` === event.target.value);
              setVoiceName(voice?.name ?? "");
              setVoiceLang(voice?.lang ?? "");
              save.reset();
            }}
            className="mt-2 w-full rounded-lg border bg-background p-3"
          >
            <option value="">Automatic system voice</option>
            {voices.map((voice, index) => (
              <option key={`${voice.lang}-${voice.name}-${index}`} value={`${voice.lang}\u0000${voice.name}`}>
                {voice.name} ({voice.lang}){voice.localService ? " · on device" : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedVoice && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const utterance = new SpeechSynthesisUtterance("Hello. I will guide your interview practice.");
              utterance.voice = selectedVoice;
              utterance.lang = selectedVoice.lang;
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(utterance);
            }}
          >
            Preview voice
          </button>
        )}
        {!voices.length && (
          <p role="status" className="text-sm text-muted-foreground">
            No selectable system voices are available. Automatic voice or text fallback will be used.
          </p>
        )}
        {voicesLoaded && voiceName && !selectedVoice && (
          <p role="status" className="text-sm text-muted-foreground">
            Your saved voice is not available on this device. Automatic voice or text fallback will be used.
          </p>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={save.isPending || (avatar === "classic" && !voiceName)}
          onClick={() => {
            setAvatar("classic");
            setVoiceName("");
            setVoiceLang("");
            save.reset();
          }}
        >
          Reset interviewer preferences
        </button>
      </fieldset>
      {save.error && <p role="alert">Could not save profile: {save.error.message}</p>}
      {save.isSuccess && <p role="status">Profile saved.</p>}
      <button
        type="submit"
        disabled={save.isPending || !name.trim() || !preferredLanguage.trim()}
        className="btn btn-primary"
      >
        {save.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
