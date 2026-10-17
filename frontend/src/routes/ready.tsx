import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/ready")({
  head: () => ({
    meta: [
      { title: "Get ready — Interview Mirror" },
      { name: "description", content: "Check your microphone and review the rules before your interview starts." },
      { property: "og:title", content: "Get ready — Interview Mirror" },
      { property: "og:description", content: "Pre-interview lobby." },
    ],
  }),
  component: Ready,
});

function Ready() {
  const [mic, setMic] = useState(false);
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Lobby</p>
        <h1 className="mt-2 text-4xl md:text-5xl">Take a breath.</h1>
        <p className="mt-3 text-muted-foreground">Frontend Developer · Technical · Middle · Practice mode · 10 questions</p>
      </div>
      <div className="mx-auto mt-10 grid max-w-3xl gap-4 md:grid-cols-2">
        <div className="card-surface p-6">
          <h2 className="text-xl">Microphone</h2>
          <div className="mt-6 flex h-16 items-end gap-1">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className={`flex-1 rounded-full ${mic ? "bg-primary" : "bg-muted"}`} style={{ height: mic ? `${20 + ((i * 37) % 80)}%` : "15%" }} />
            ))}
          </div>
          <button className="btn btn-ghost mt-6 w-full" onClick={() => setMic(!mic)}>
            {mic ? "✓ Mic working" : "Test microphone"}
          </button>
          <p className="mt-3 text-xs text-muted-foreground">Audio is transcribed live and never stored.</p>
        </div>
        <div className="card-surface p-6">
          <h2 className="text-xl">How it works</h2>
          <ul className="mt-4 space-y-3 text-sm">
            <li>• 10 main questions; follow-ups don't count.</li>
            <li>• Difficulty adapts to your answers.</li>
            <li>• Ask for a hint any time (Practice mode).</li>
            <li>• No time limit — elapsed time is shown.</li>
            <li>• End early anytime; partial feedback is saved.</li>
          </ul>
        </div>
      </div>
      <div className="mt-10 flex justify-center gap-3">
        <Link to="/setup" className="btn btn-ghost">Change settings</Link>
        <Link to="/interview" className="btn btn-primary">Start interview</Link>
      </div>
    </AppShell>
  );
}
