import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Api } from "@/lib/api/client";

export function DashboardSummary() {
  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: Api.getDashboardSummary,
    retry: false,
  });
  const [selected, setSelected] = useState(0);
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
  const data = summary.data;
  const group = data.groups[selected] ?? data.groups[0];
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
                {positions.map((position, i) => (
                  <circle
                    key={points[i].interviewId}
                    cx={position.split(",")[0]}
                    cy={position.split(",")[1]}
                    r="1.5"
                  >
                    <title>
                      {points[i].date}: {points[i].overall} / 10
                    </title>
                  </circle>
                ))}
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
      {(["strengths", "weaknesses"] as const).map((kind) => (
        <div key={kind} className="card-surface p-5">
          <h2 className="text-xl capitalize">{kind}</h2>
          {data[kind].filter((claim) => claim.sources.length > 0).length === 0 ? (
            <p>No supported observations yet.</p>
          ) : (
            <ul>
              {data[kind]
                .filter((claim) => claim.sources.length > 0)
                .map((claim, i) => (
                  <li key={i}>
                    {claim.text}{" "}
                    <Link to="/report" search={{ interviewId: claim.sources[0].interviewId }}>
                      Review evidence
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
      <div className="card-surface p-5">
        <h2 className="text-xl">Suggested practice</h2>
        {data.suggestions
          .filter((s) => s.sources.length > 0)
          .map((suggestion, i) => (
            <p key={i}>
              {suggestion.topic} <Link to="/setup">Configure practice</Link>
            </p>
          ))}
        <Link to="/setup">Choose your next practice</Link>
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
