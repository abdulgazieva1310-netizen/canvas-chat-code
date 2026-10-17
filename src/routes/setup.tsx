import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "New interview — Interview Mirror" },
      { name: "description", content: "Configure role, level, mode and question count for your mock interview." },
      { property: "og:title", content: "New interview — Interview Mirror" },
      { property: "og:description", content: "Configure your AI mock interview." },
    ],
  }),
  component: Setup,
});

function Choice({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="eyebrow mb-3">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" className="chip" data-active={value === o} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
}

function Setup() {
  const [type, setType] = useState("Technical");
  const [role, setRole] = useState("Frontend Developer");
  const [level, setLevel] = useState("Middle");
  const [mode, setMode] = useState("Practice");
  const [input, setInput] = useState("Voice");
  const [count, setCount] = useState("10");
  return (
    <AppShell>
      <p className="eyebrow">Custom setup</p>
      <h1 className="mt-2 text-4xl">Shape your interview.</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="card-surface space-y-7 p-7 md:col-span-2">
          <Choice label="Interview type" options={["Technical", "Behavioral", "Role-specific"]} value={type} onChange={setType} />
          <Choice label="Target role" options={["Frontend Developer", "Backend Developer", "Full Stack Developer", "QA Engineer", "Data Analyst", "DevOps Engineer"]} value={role} onChange={setRole} />
          <Choice label="Starting level" options={["Junior", "Middle", "Senior"]} value={level} onChange={setLevel} />
          <Choice label="Mode" options={["Practice", "Real Interview"]} value={mode} onChange={setMode} />
          <Choice label="Answer by" options={["Voice", "Text"]} value={input} onChange={setInput} />
          <Choice label="Main questions" options={["5", "10", "15"]} value={count} onChange={setCount} />
          <div>
            <p className="eyebrow mb-3">Job description (optional)</p>
            <textarea rows={4} placeholder="Paste a job posting to tailor questions…" className="w-full rounded-lg border border-input bg-background p-3 text-sm" />
          </div>
        </div>
        <aside className="card-surface h-fit p-7 md:sticky md:top-24">
          <h2 className="text-xl">Summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            {[["Type", type], ["Role", role], ["Level", `${level} · adaptive`], ["Mode", mode], ["Input", input], ["Questions", `${count} + follow-ups`]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            {mode === "Practice" ? "Hints and feedback after each answer." : "No hints. Feedback at the end only."}
          </p>
          <Link to="/ready" className="btn btn-primary mt-6 w-full">Continue →</Link>
        </aside>
      </div>
    </AppShell>
  );
}
