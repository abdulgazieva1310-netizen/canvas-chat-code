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
  const seenTopics = new Set<string>();
  const practiceTopics = (report?.feedback.questions ?? [])
    .flatMap((question) => {
      const topics = question.practiceTopics?.length
        ? question.practiceTopics
        : question.practiceTopic
          ? [question.practiceTopic]
          : [];
      const hasWeakness =
        question.miss.trim() && !/^(none|no supported|nothing was missed)\b/i.test(question.miss.trim());
      if (!hasWeakness) return [];
      return topics
        .map((topic) => topic.trim().replace(/\s+/g, " "))
        .filter(
          (topic) =>
            topic.length > 0 &&
            topic.length <= 120 &&
            !/^(a description of|an explanation of|expected answer|rubric|generic topic)\b/i.test(topic) &&
            !/[.!?]\s/.test(topic),
        );
    })
    .filter((topic) => {
      const key = topic.replace(/\s+/g, " ").toLocaleLowerCase();
      if (!key || seenTopics.has(key)) return false;
      seenTopics.add(key);
      return true;
    })
    .slice(0, 3);
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
      {([
        [strengths, "Strengths"],
        [weaknesses, "Weaknesses"],
      ] as const).map(([kind, title]) => (
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
        <h2 className="text-xl">Suggested practice</h2>
        {latestReport.isPending && latestInterviewId ? (
          <p>Loading practice topics…</p>
        ) : latestReport.error ? (
          <p role="alert">Could not load practice topics for this interview.</p>
        ) : practiceTopics.length === 0 ? (
          <p>No specific practice topics were identified in this interview’s feedback.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-3">
            {practiceTopics.map((topic) => (
              <li key={topic}>
                <Link
                  to="/setup"
                  search={{
                    practiceTopic: topic,
                    role: report?.interview.setup.role,
                    interviewType: report?.interview.setup.type,
                    level: report?.interview.setup.level,
                  }}
                  className="btn btn-ghost"
                >
                  Practice: {topic}
                </Link>
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
