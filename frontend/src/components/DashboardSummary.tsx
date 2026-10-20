import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Api } from "@/lib/api/client";

function uniqueFeedback(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function DashboardSummary() {
  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: Api.getDashboardSummary,
    retry: false,
  });
  const [selected, setSelected] = useState(0);
  const [dismissedTopics, setDismissedTopics] = useState<Set<string>>(() => new Set());
  const dashboardData = summary.data;
  const group = dashboardData?.groups[selected] ?? dashboardData?.groups[0];
  const latestInterviewId = group?.latestInterviewId;
  const latestReport = useQuery({
    queryKey: ["dashboard-latest-report", latestInterviewId],
    queryFn: () => Api.getReport(latestInterviewId!),
    enabled: !!latestInterviewId,
    retry: false,
  });
  if (summary.isPending)
    return (
      <p role="status" className="mt-8">
        Loading progress…
      </p>
    );
  if (summary.error)
    return (
      <section className="card-surface mt-8 p-6">
        <p role="alert">Could not load progress: {summary.error.message}</p>
        <button className="btn btn-primary mt-3" onClick={() => void summary.refetch()}>
          Retry progress
        </button>
      </section>
    );
  const data = dashboardData!;
  const report =
    latestReport.data?.feedback.interviewId === latestInterviewId ? latestReport.data : undefined;
  const strengths = uniqueFeedback(report?.feedback.strengths ?? []);
  const weaknesses = uniqueFeedback(report?.feedback.gaps ?? []);
  const groupKey = JSON.stringify([group?.role, group?.type, group?.mode, group?.level]);
  const topicKey = (topic: string) => `${groupKey}:${topic.toLocaleLowerCase()}`;
  const groupSuggestions = group && group.scoredCount >= 2 ? (group.suggestions ?? []) : [];
  const practiceSuggestions = groupSuggestions.filter(
    (suggestion) => !dismissedTopics.has(topicKey(suggestion.topic)),
  );
  const label = group ? `${group.role} · ${group.type} · ${group.mode} · ${group.level}` : "";
  const points = group?.trends ?? [];
  const positions = points.map(
    (p, i) =>
      `${points.length === 1 ? 50 : (i * 100) / (points.length - 1)},${100 - p.overall * 10}`,
  );
  return (
    <section aria-label="Personal progress" className="mt-8 space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card-surface p-5">
          <p>Completed interviews</p>
          <p className="text-3xl">{data.completedCount}</p>
        </div>
        <div className="card-surface p-5">
          <p>Scored interviews in selected group</p>
          <p className="text-3xl">{group?.scoredCount ?? 0}</p>
        </div>
        <div className="card-surface p-5">
          <p>Group average (1–10)</p>
          <p className="text-3xl">{group?.overall ?? "Not scored"}</p>
        </div>
      </div>
      {data.completedCount === 0 && <p>Complete an interview to start tracking progress.</p>}
      {!group ? (
        <p>No comparable scored history yet.</p>
      ) : (
        <div className="card-surface p-6 space-y-4">
          <label>
            Compare interviews
            <select
              aria-label="Compare interviews"
              className="ml-3 rounded border bg-background p-2"
              value={Math.min(selected, data.groups.length - 1)}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {data.groups.map((g, i) => (
                <option key={`${g.role}-${g.type}-${g.mode}-${g.level}`} value={i}>
                  {g.role} · {g.type} · {g.mode} · {g.level}
                </option>
              ))}
            </select>
          </label>
          <h2 className="text-xl">Score trend</h2>
          <p>{label} · score scale 1–10</p>
          {points.length === 0 ? (
            <p>No scored interviews in this group.</p>
          ) : (
            <>
              {points.length === 1 && (
                <p>One scored interview; more interviews are needed to show a trend.</p>
              )}
              <svg
                role="img"
                aria-label={`Dated score trend for ${label}; scores from 1 to 10. Values in the table below.`}
                viewBox="-5 -5 110 110"
                className="h-44 w-full"
                preserveAspectRatio="none"
              >
                {points.length > 1 && (
                  <polyline
                    points={positions.join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                )}
                {points.map((point, i) => {
                  const position = positions[i] ?? "0,0";
                  return (
                    <circle
                      key={point.interviewId}
                      cx={position.split(",")[0]}
                      cy={position.split(",")[1]}
                      r="1.5"
                    >
                      <title>
                        {point.date}: {point.overall} / 10
                      </title>
                    </circle>
                  );
                })}
              </svg>
              <table className="w-full text-left">
                <caption>Score trend values (1–10)</caption>
                <thead>
                  <tr>
                    <th>Date (UTC)</th>
                    <th>Score</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.interviewId}>
                      <td>{new Date(p.date).toISOString().slice(0, 10)}</td>
                      <td>{p.overall} / 10</td>
                      <td>
                        <Link to="/report" search={{ interviewId: p.interviewId }}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h2 className="text-xl">By category</h2>
          <dl>
            {Object.entries(group.scores).map(([category, score]) => (
              <div key={category} className="flex justify-between">
                <dt>{category}</dt>
                <dd>{score === null ? "Not scored" : `${score} / 10`}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="text-sm">Scores are AI coaching estimates, not measures of hiring readiness.</p>
      {(
        [
          [strengths, "Strengths"],
          [weaknesses, "Weaknesses"],
        ] as const
      ).map(([kind, title]) => (
        <div key={title} className="card-surface p-5">
          <h2 className="text-xl">{title}</h2>
          {latestReport.isPending && latestInterviewId ? (
            <p>Loading feedback…</p>
          ) : latestReport.error ? (
            <p role="alert">Could not load this interview’s feedback.</p>
          ) : kind.length === 0 ? (
            <p>No supported observations yet.</p>
          ) : (
            <ul>
              {kind.map((text) => (
                <li key={text}>
                  {text}{" "}
                  {latestInterviewId && (
                    <Link to="/report" search={{ interviewId: latestInterviewId }}>
                      Review report
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl">Your learning plan</h2>
          <button
            className="btn btn-ghost"
            disabled={summary.isFetching}
            onClick={() => {
              setDismissedTopics(new Set());
              void summary.refetch();
            }}
          >
            {summary.isFetching ? "Refreshing…" : "Refresh plan"}
          </button>
        </div>
        <p className="mt-2 text-sm">
          Coaching guidance based on repeated feedback; one-off findings stay out of the plan, and
          this does not predict hiring outcomes.
        </p>
        {practiceSuggestions.length === 0 && groupSuggestions.length > 0 ? (
          <p className="mt-3">
            You dismissed the current recommendations. Refresh the plan to review them again.
          </p>
        ) : practiceSuggestions.length === 0 ? (
          <p className="mt-3">
            {data.completedCount === 0
              ? "Complete practice interviews to build a learning plan. We’ll wait for the same improvement area to appear in at least two interviews before recommending a focus."
              : "No repeated topics found for this group yet."}
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {practiceSuggestions.map((suggestion) => (
              <li key={suggestion.topic} className="rounded border p-3">
                <p className="font-medium">Focus: {suggestion.topic}</p>
                <p className="text-sm">
                  This area appeared in{" "}
                  {new Set(suggestion.sources.map((source) => source.interviewId)).size} completed
                  interviews.
                </p>
                <Link
                  to="/setup"
                  search={{
                    practiceTopic: suggestion.topic,
                    role: suggestion.setup.role,
                    interviewType: suggestion.setup.type,
                    level: suggestion.setup.level,
                  }}
                  className="btn btn-ghost"
                >
                  Start practice: {suggestion.topic}
                </Link>
                <button
                  className="btn btn-ghost ml-2"
                  onClick={() =>
                    setDismissedTopics((current) =>
                      new Set(current).add(topicKey(suggestion.topic)),
                    )
                  }
                >
                  Dismiss
                </button>
                <p className="mt-2 text-sm">
                  Evidence:{" "}
                  {suggestion.sources.map((source, index) => (
                    <span key={`${source.interviewId}-${source.answerId}`}>
                      {index > 0 ? ", " : ""}
                      <Link to="/report" search={{ interviewId: source.interviewId }}>
                        Review interview {index + 1}
                      </Link>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card-surface p-5">
        <h2 className="text-xl">Recent activity</h2>
        {data.recentActivity.length === 0 ? (
          <p>No recent activity yet.</p>
        ) : (
          <ul>
            {data.recentActivity.map((interview) => (
              <li key={interview.id}>
                <Link
                  to={interview.status === "active" ? "/interview" : "/report"}
                  search={{ interviewId: interview.id }}
                >
                  {interview.setup.role} · {interview.status} ·{" "}
                  {new Date(interview.startedAt).toISOString().slice(0, 10)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
