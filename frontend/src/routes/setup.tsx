import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
import { defaultSetup } from "@/lib/api/default-setup";
import { targetRoles, type InterviewSetup } from "@/lib/api/types";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/setup")({
  validateSearch: (search: Record<string, unknown>) => ({
    practiceTopic:
      typeof search["practiceTopic"] === "string" ? search["practiceTopic"].trim() : "",
    role:
      typeof search["role"] === "string" &&
      targetRoles.includes(search["role"] as (typeof targetRoles)[number])
        ? (search["role"] as (typeof targetRoles)[number])
        : undefined,
    interviewType:
      search["interviewType"] === "Technical" ||
      search["interviewType"] === "Behavioral" ||
      search["interviewType"] === "Role-specific"
        ? search["interviewType"]
        : undefined,
    level:
      search["level"] === "Junior" || search["level"] === "Middle" || search["level"] === "Senior"
        ? search["level"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "New interview — Interview Mirror" },
      {
        name: "description",
        content: "Configure role, level, mode and question count for your mock interview.",
      },
      { property: "og:title", content: "New interview — Interview Mirror" },
      { property: "og:description", content: "Configure your AI mock interview." },
    ],
  }),
  component: Setup,
});

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="eyebrow mb-3">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className="chip"
            data-active={value === o}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Setup() {
  const {
    practiceTopic,
    role: targetedRole,
    interviewType,
    level: targetedLevel,
  } = Route.useSearch();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [setup, setSetup] = useState<InterviewSetup>(() => ({
    ...defaultSetup,
    ...(targetedRole ? { role: targetedRole } : {}),
    ...(interviewType ? { type: interviewType } : {}),
    ...(targetedLevel ? { level: targetedLevel } : {}),
    ...(practiceTopic ? { mode: "Practice" as const, practiceTopic } : {}),
  }));
  const { type, role, level, mode, input, questionCount: count } = setup;
  const update =
    <K extends keyof InterviewSetup>(key: K) =>
    (value: InterviewSetup[K]) =>
      setSetup((s) => ({ ...s, [key]: value }));
  const start = useMutation({
    mutationFn: (setupData: InterviewSetup) => Api.startInterview(setupData),
    onSuccess: async (interview) => {
      client.setQueryData(["interview", interview.id], interview);
      void client.invalidateQueries({ queryKey: ["profile"] });
      await navigate({ to: "/interview", search: { interviewId: interview.id } });
    },
  });
  return (
    <AppShell>
      <p className="eyebrow">Custom setup</p>
      <h1 className="mt-2 text-4xl">Shape your interview.</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="card-surface space-y-7 p-7 md:col-span-2">
          <Choice
            label="Interview type"
            options={["Technical", "Behavioral", "Role-specific"]}
            value={type}
            onChange={update("type")}
          />
          <Choice
            label="Target role"
            options={targetRoles}
            value={role}
            onChange={update("role")}
          />
          <Choice
            label="Starting level"
            options={["Junior", "Middle", "Senior"]}
            value={level}
            onChange={update("level")}
          />
          <Choice
            label="Interview language"
            options={["English", "Russian"]}
            value={setup.language}
            onChange={update("language")}
          />
          <p className="-mt-5 text-sm text-muted-foreground">
            Russian is a preview requiring server enablement. Questions and coaching use the selected
            language. Speech recognition and playback depend on browser language support.
          </p>
          <Choice
            label="Mode"
            options={["Practice", "Real Interview"]}
            value={mode}
            onChange={(value) =>
              setSetup((current) => ({
                ...current,
                mode: value,
                ...(value === "Practice" ? {} : { practiceTopic: undefined }),
              }))
            }
          />
          {mode === "Practice" && (
            <div>
              <label htmlFor="practice-topic" className="eyebrow mb-3 block">
                Targeted practice topic (optional)
              </label>
              <input
                id="practice-topic"
                value={setup.practiceTopic ?? ""}
                onChange={(event) => update("practiceTopic")(event.target.value || undefined)}
                maxLength={120}
                className="w-full rounded-lg border border-input bg-background p-3 text-sm"
                placeholder="For example, sliding window algorithm"
              />
            </div>
          )}
          <Choice
            label="Answer by"
            options={["Voice", "Text"]}
            value={input}
            onChange={update("input")}
          />
          <Choice
            label="Main questions"
            options={["5", "10", "15"]}
            value={String(count)}
            onChange={(value) =>
              update("questionCount")(Number(value) as InterviewSetup["questionCount"])
            }
          />
          <div>
            <p className="eyebrow mb-3">Job description (optional)</p>
            <textarea
              value={setup.jobDescription ?? ""}
              onChange={(e) => update("jobDescription")(e.target.value)}
              rows={4}
              placeholder="Paste a job posting to tailor questions…"
              className="w-full rounded-lg border border-input bg-background p-3 text-sm"
            />
          </div>
        </div>
        <aside className="card-surface h-fit p-7 md:sticky md:top-24">
          <h2 className="text-xl">Summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            {[
              ["Type", type],
              ["Role", role],
              ["Level", `${level} · adaptive`],
              ["Mode", mode],
              ["Language", setup.language],
              ["Input", input],
              ["Questions", `${count} + follow-ups`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            {mode === "Practice"
              ? "Hints and feedback after each answer."
              : "No hints. Feedback at the end only."}
          </p>
          {start.error && <p role="alert">Could not start interview: {start.error.message}</p>}
          <button
            disabled={start.isPending}
            type="button"
            onClick={() => start.mutate(setup)}
            className="btn btn-primary mt-6 w-full"
          >
            {start.isPending ? "Starting…" : "Start interview"}
          </button>
        </aside>
      </div>
    </AppShell>
  );
}
