import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import { targetRoles, type HistoryQuery, type Interview } from "@/lib/api/types";

const interviewTypes = ["Technical", "Behavioral", "Role-specific"] as const;

function validateSearch(search: Record<string, unknown>): HistoryQuery {
  const page = Number(search["page"] ?? 1);
  const minScore = Number(search["minScore"]);
  const maxScore = Number(search["maxScore"]);
  const role = targetRoles.find((candidate) => candidate === search["role"]);
  const type = interviewTypes.find((candidate) => candidate === search["type"]);
  const date = (name: "startDate" | "endDate") => {
    const value = search[name];
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
      ? undefined
      : value;
  };
  const score = (value: number) =>
    Number.isFinite(value) && value >= 1 && value <= 10 ? value : undefined;
  const text = typeof search["search"] === "string" ? search["search"].trim().slice(0, 200) : "";
  return {
    ...(role ? { role } : {}),
    ...(type ? { type } : {}),
    ...(date("startDate") ? { startDate: date("startDate") } : {}),
    ...(date("endDate") ? { endDate: date("endDate") } : {}),
    ...(score(minScore) ? { minScore: score(minScore) } : {}),
    ...(score(maxScore) ? { maxScore: score(maxScore) } : {}),
    ...(text ? { search: text } : {}),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}

export const Route = createFileRoute("/history")({
  validateSearch,
  head: () => ({ meta: [{ title: "Interview History — Interview Mirror" }] }),
  component: History,
});

function History() {
  const navigate = useNavigate();
  const [selected,setSelected]=useState<string[]>([]);
  const filters = Route.useSearch();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const query = { ...filters, page, pageSize };
  const history = useQuery({
    queryKey: ["history-page", query],
    queryFn: async () => {
      const data = await Api.getHistoryPage(query);
      // Support the existing array response while the paginated backend rolls out.
      return Array.isArray(data) ? { items: data as Interview[], total: data.length, page: 1, pageSize } : data;
    },
    retry: false,
  });
  const update = (key: keyof HistoryQuery, value: string) => {
    void navigate({
      to: "/history",
      search: (previous) => {
        const next: Record<string, unknown> = { ...previous, page: 1 };
        if (value) next[key] = key === "minScore" || key === "maxScore" ? Number(value) : value;
        else delete next[key];
        return next as HistoryQuery;
      },
    });
  };
  const pageCount = Math.max(1, Math.ceil((history.data?.total ?? 0) / pageSize));
  const filtered = Object.keys(filters).some((key) => key !== "page" && key !== "pageSize");
  return (
    <AppShell>
      <p className="eyebrow">Your saved sessions</p>
      <h1 className="mt-2 text-4xl">Interview History</h1>
      <p>Select two saved reports to compare. Active interviews cannot be selected.</p>
      {selected.length===2 && <Link className="btn btn-primary mt-3" to="/compare" search={{first:selected[0]!,second:selected[1]!}}>Compare selected reports</Link>}
      <div className="card-surface mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm" htmlFor="history-role">
          Role
          <select
            id="history-role"
            value={filters.role ?? ""}
            onChange={(e) => update("role", e.target.value)}
            className="rounded border bg-background p-2"
          >
            <option value="">All roles</option>
            {targetRoles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm" htmlFor="history-type">
          Interview type
          <select
            id="history-type"
            value={filters.type ?? ""}
            onChange={(e) => update("type", e.target.value)}
            className="rounded border bg-background p-2"
          >
            <option value="">All types</option>
            {interviewTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm" htmlFor="history-start-date">
          Start date (UTC)
          <input
            id="history-start-date"
            type="date"
            value={filters.startDate ?? ""}
            onChange={(e) => update("startDate", e.target.value)}
            className="rounded border bg-background p-2"
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="history-end-date">
          End date (UTC)
          <input
            id="history-end-date"
            type="date"
            value={filters.endDate ?? ""}
            onChange={(e) => update("endDate", e.target.value)}
            className="rounded border bg-background p-2"
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="history-min-score">
          Minimum score
          <input
            id="history-min-score"
            type="number"
            min="1"
            max="10"
            step="0.1"
            value={filters.minScore ?? ""}
            onChange={(e) => update("minScore", e.target.value)}
            className="rounded border bg-background p-2"
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="history-max-score">
          Maximum score
          <input
            id="history-max-score"
            type="number"
            min="1"
            max="10"
            step="0.1"
            value={filters.maxScore ?? ""}
            onChange={(e) => update("maxScore", e.target.value)}
            className="rounded border bg-background p-2"
          />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2" htmlFor="history-search">
          Search role or job description
          <input
            id="history-search"
            type="search"
            maxLength={200}
            value={filters.search ?? ""}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Case-insensitive text search"
            className="rounded border bg-background p-2"
          />
        </label>
        {filtered && (
          <button
            type="button"
            className="btn btn-ghost self-end"
            onClick={() => void navigate({ to: "/history", search: { page: 1, pageSize } })}
          >
            Clear filters
          </button>
        )}
      </div>

      {history.isPending && (
        <p role="status" className="mt-6">
          Loading interview history…
        </p>
      )}
      {history.error && (
        <section className="card-surface mt-6 p-5">
          <p role="alert">Could not load interview history: {history.error.message}</p>
          <button
            type="button"
            className="btn btn-primary mt-3"
            onClick={() => void history.refetch()}
          >
            Retry
          </button>
        </section>
      )}
      {!history.isPending && !history.error && history.data?.items.length === 0 && (
        <div className="card-surface mt-6 p-6">
          <p>{filtered ? "No interviews match these filters." : "No saved interviews yet."}</p>
          {filtered && (
            <button
              type="button"
              className="btn btn-ghost mt-3"
              onClick={() => void navigate({ to: "/history", search: { page: 1, pageSize } })}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {!history.isPending && !history.error && (history.data?.items.length ?? 0) > 0 && (
        <>
          <ul className="mt-6 divide-y divide-border rounded-xl border">
            {history.data!.items.map((interview) => (
              <HistoryItem key={interview.id} interview={interview} selected={selected.includes(interview.id)}
                disabled={!selected.includes(interview.id) && selected.length===2}
                toggle={()=>setSelected(current=>current.includes(interview.id) ? current.filter(id=>id!==interview.id) : [...current,interview.id])} />
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p aria-live="polite">
              Page {page} of {pageCount} · {history.data!.total} sessions
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={page <= 1}
                onClick={() =>
                  void navigate({
                    to: "/history",
                    search: (previous) => ({ ...previous, page: page - 1 }),
                  })
                }
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={page >= pageCount}
                onClick={() =>
                  void navigate({
                    to: "/history",
                    search: (previous) => ({ ...previous, page: page + 1 }),
                  })
                }
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function HistoryItem({ interview, selected, disabled, toggle }: { interview: Interview; selected:boolean; disabled:boolean; toggle:()=>void }) {
  const report = useQuery({
    queryKey: ["report", interview.id],
    queryFn: () => Api.getReport(interview.id),
    enabled: interview.status !== "active",
    retry: false,
  });
  const destination = interview.status === "active" ? "/interview" : "/report";
  const status =
    interview.status === "complete"
      ? "Completed"
      : interview.status === "incomplete"
        ? "Incomplete"
        : "Active";
  const score = report.data?.feedback.overall;
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 p-4">
      <label className="text-sm"><input type="checkbox" checked={selected} disabled={disabled || interview.status==="active"} onChange={toggle}
        aria-label={`Compare ${interview.setup.role} ${interview.id}`} /> Select for comparison</label>
      <Link
        to={destination}
        search={{ interviewId: interview.id }}
        className="min-w-0 flex-1 rounded focus-visible:outline focus-visible:outline-2"
      >
        <span className="block font-medium">
          {interview.setup.role} · {interview.setup.type}
        </span>
        <span className="block text-sm text-muted-foreground">
          {new Date(interview.startedAt).toISOString().slice(0, 10)} UTC · {interview.setup.mode} ·{" "}
          {status}
        </span>
      </Link>
      <span aria-label="Interview score" className="text-sm">
        {interview.status === "active"
          ? "In progress"
          : report.isPending
            ? "Loading score…"
            : report.error
              ? "Score unavailable"
              : score == null
                ? "Unscored"
                : `Score ${score} / 10`}
      </span>
      <Link to={destination} search={{ interviewId: interview.id }} className="btn btn-ghost">
        {interview.status === "active" ? "Resume interview" : "Open report"}
      </Link>
    </li>
  );
}
