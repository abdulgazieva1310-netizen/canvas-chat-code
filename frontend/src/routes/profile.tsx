import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import { targetRoles, type Level, type Role, type User } from "@/lib/api/types";

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
      {profile.data && <ProfileForm key={profile.data.id} user={profile.data} />}
    </AppShell>
  );
}

function ProfileForm({ user }: { user: User }) {
  const client = useQueryClient();
  const [name, setName] = useState(user.name);
  const [targetRole, setTargetRole] = useState<Role>(user.targetRole);
  const [level, setLevel] = useState<Level>(user.level);
  const [preferredLanguage, setPreferredLanguage] = useState(user.preferredLanguage);
  const save = useMutation({
    mutationFn: () =>
      Api.updateProfile({
        name: name.trim(),
        targetRole,
        level,
        preferredLanguage: preferredLanguage.trim(),
      }),
    onSuccess: (updated) => {
      client.setQueryData(["profile"], updated);
      setName(updated.name);
      setTargetRole(updated.targetRole);
      setLevel(updated.level);
      setPreferredLanguage(updated.preferredLanguage);
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
        Your preference is saved for future language support. Interviews and feedback are currently
        in English.
      </p>
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
