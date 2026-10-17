import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/interview")({
  head: () => ({
    meta: [
      { title: "Live interview — Interview Mirror" },
      { name: "description", content: "Answer questions from your AI interviewer by voice or text." },
      { property: "og:title", content: "Live interview — Interview Mirror" },
      { property: "og:description", content: "Live AI mock interview." },
    ],
  }),
  component: Interview,
});

type Msg = { from: "ai" | "you" | "hint"; text: string };

const initial: Msg[] = [
  { from: "ai", text: "Hi Aruzhan, let's begin. Can you explain how the browser's event loop handles a resolved Promise versus a setTimeout with 0ms?" },
  { from: "you", text: "Promises go to the microtask queue, so they run before setTimeout callbacks, which are macrotasks — after the current call stack clears." },
  { from: "hint", text: "Good start. Mention when microtasks drain relative to rendering to make the answer complete." },
  { from: "ai", text: "Nice. Follow-up: what happens if a microtask keeps scheduling new microtasks?" },
];

function Interview() {
  const [msgs, setMsgs] = useState(initial);
  const [text, setText] = useState("");
  const [sec, setSec] = useState(412);
  const [listening, setListening] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const send = () => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { from: "you", text }, { from: "ai", text: "Right — that would starve the macrotask queue and block rendering. Moving on: how would you debounce a search input in React?" }]);
    setText("");
  };
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive pulse-dot" />
          <span className="font-display text-lg">Frontend · Technical</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">Practice</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span>Question <b>3</b> / 10</span>
          <span className="tabular-nums text-muted-foreground">{mm}:{ss}</span>
          <Link to="/report" className="btn btn-ghost py-1.5">End early</Link>
        </div>
      </header>
      <div className="h-1 bg-muted"><div className="h-1 w-[30%] bg-accent" /></div>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-6 py-8 md:grid-cols-[1fr_320px]">
        <section className="flex flex-col">
          <div className="flex-1 space-y-4">
            {msgs.map((m, i) =>
              m.from === "hint" ? (
                <div key={i} className="rounded-lg border border-dashed border-accent bg-accent/10 p-3 text-sm">
                  <span className="eyebrow mr-2">Coach</span>{m.text}
                </div>
              ) : (
                <div key={i} className={`flex ${m.from === "you" ? "justify-end" : ""}`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3 ${m.from === "ai" ? "card-surface font-display text-lg" : "bg-primary text-primary-foreground"}`}>
                    {m.text}
                  </div>
                </div>
              ),
            )}
          </div>
          <div className="card-surface mt-6 flex items-center gap-3 p-3">
            <button onClick={() => setListening(!listening)} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${listening ? "bg-destructive text-destructive-foreground" : "bg-muted"}`} aria-label="Toggle microphone">
              ●
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={listening ? "Listening… or type your answer" : "Type your answer"} className="flex-1 bg-transparent px-2 text-sm outline-none" />
            <button onClick={send} className="btn btn-primary">Send</button>
          </div>
        </section>
        <aside className="space-y-4">
          <div className="card-surface p-5">
            <p className="eyebrow">Interviewer</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-12 items-end gap-1">
                {[40, 70, 50, 90, 60].map((h, i) => <div key={i} className="w-1.5 rounded-full bg-primary pulse-dot" style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }} />)}
              </div>
              <p className="text-sm text-muted-foreground">Speaking…</p>
            </div>
          </div>
          <div className="card-surface p-5">
            <p className="eyebrow">Last answer</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {[["Accuracy", 8], ["Completeness", 6], ["Clarity", 8], ["Structure", 7]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-secondary p-2"><p className="text-xs text-muted-foreground">{k}</p><p className="font-display text-xl">{v}</p></div>
              ))}
            </div>
          </div>
          <button className="btn btn-accent w-full">Ask for a hint</button>
        </aside>
      </div>
    </div>
  );
}
