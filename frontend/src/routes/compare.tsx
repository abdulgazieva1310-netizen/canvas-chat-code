import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import type { InterviewReport, Scores } from "@/lib/api/types";

export function comparisonSearch(search: Record<string,unknown>) {
  const id=(value:unknown)=>typeof value==="string" && value.trim().length<=128 ? value.trim() : "";
  return {first:id(search["first"]),second:id(search["second"])};
}
export const Route=createFileRoute("/compare")({validateSearch:comparisonSearch,component:Comparison});
export function compatibleReports(first:InterviewReport,second:InterviewReport) {
  return (["role","type","mode","language"] as const).every(field=>first.interview.setup[field]===second.interview.setup[field]);
}
export function scoreDelta(first:number|null|undefined,second:number|null|undefined) {
  if (first==null || second==null) return "Not comparable";
  const delta=Number((second-first).toFixed(1));
  return `${delta>0 ? "+" : ""}${delta.toFixed(1)}`;
}
function Comparison() {
  const {first,second}=Route.useSearch();
  const valid=!!first && !!second && first!==second;
  const queries=useQueries({queries:[first,second].map(id=>({queryKey:["report",id],queryFn:()=>Api.getReport(id),enabled:valid,retry:false}))});
  if(!valid)return <AppShell><h1 className="text-4xl">Compare saved reports</h1><p>Select two distinct saved reports in History.</p><Link to="/history">Choose reports</Link></AppShell>;
  if(queries.some(q=>q.isPending))return <AppShell><p role="status">Loading comparison…</p></AppShell>;
  if(queries.some(q=>q.error))return <AppShell><p role="alert">Could not load both saved reports. They may be unavailable.</p><button className="btn btn-ghost" onClick={()=>queries.forEach(q=>void q.refetch())}>Retry comparison</button></AppShell>;
  const reports=queries.map(q=>q.data!);
  if(reports.some(r=>r.interview.status==="active"))return <AppShell><p>End both interviews before comparing feedback.</p></AppShell>;
  const compatible=compatibleReports(reports[0]!,reports[1]!);
  const categories=["accuracy","completeness","clarity","structure"] as (keyof Scores)[];
  return <AppShell><h1 className="text-4xl">Compare saved reports</h1>
    <p className="mt-3">Scores are approximate AI coaching estimates, not predictions of hiring success. The questions may differ; score changes are not controlled measurements.</p>
    {!compatible && <p role="alert" className="mt-4">These reports have different roles, interview types, modes or interview languages. Score changes are not comparable.</p>}
    {reports[0]!.interview.setup.level!==reports[1]!.interview.setup.level && <p className="mt-3 font-semibold">Starting levels differ. Consider difficulty when reading these results.</p>}
    <div className="mt-6 grid gap-4 md:grid-cols-2">{reports.map((report,index)=><section key={report.interview.id} aria-label={`Report ${index+1}`} className="card-surface min-w-0 p-5">
      <h2 className="text-xl">Report {index+1}</h2>
      <p>{report.interview.setup.role} · {report.interview.setup.type} · {report.interview.setup.mode} · {report.interview.setup.language}</p>
      <p>Started {new Date(report.interview.startedAt).toISOString().slice(0,10)} UTC</p>
      <p>Starting level: {report.interview.setup.level} · Effective level: {report.interview.effectiveLevel ?? report.interview.setup.level}</p>
      <p>{report.interview.status==="incomplete" ? "Incomplete (partial results)" : "Completed"} · {report.interview.answeredCount} of {report.interview.setup.questionCount} answered</p>
      <p>Overall: {report.feedback.overall ?? "Unscored"}</p>
      <h3 className="mt-3 font-semibold">Strengths</h3><ul>{report.feedback.strengths.map((text,i)=><li key={i}>{text}</li>)}</ul>
      <h3 className="mt-3 font-semibold">Weaknesses</h3><ul>{report.feedback.gaps.map((text,i)=><li key={i}>{text}</li>)}</ul>
      <Link to="/report" search={{interviewId:report.interview.id}}>Review full report {index+1}</Link>
    </section>)}</div>
    <div className="mt-6 overflow-x-auto"><table className="w-full text-left"><caption>Saved category scores (1–10){compatible ? "; change is second minus first" : "; incompatible reports"}</caption>
      <thead><tr><th>Category</th><th>First</th><th>Second</th>{compatible && <th>Change</th>}</tr></thead>
      <tbody>{["overall",...categories].map(category=>{
        const a=category==="overall" ? reports[0]!.feedback.overall : reports[0]!.feedback.scores?.[category as keyof Scores];
        const b=category==="overall" ? reports[1]!.feedback.overall : reports[1]!.feedback.scores?.[category as keyof Scores];
        return <tr key={category}><th>{category}</th><td>{a ?? "Unscored"}</td><td>{b ?? "Unscored"}</td>{compatible && <td>{scoreDelta(a,b)}</td>}</tr>;
      })}</tbody></table></div>
  </AppShell>;
}
