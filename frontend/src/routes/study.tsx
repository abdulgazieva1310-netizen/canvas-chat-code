import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Api } from "@/lib/api/client";
import type { StudyQuestion } from "@/lib/api/types";
export const Route = createFileRoute("/study")({component:Study});
function Study() {
  const [page,setPage]=useState(1);
  const query=useQuery({queryKey:["study",page],queryFn:()=>Api.getStudyQuestions(page),retry:false});
  return <AppShell><h1 className="text-4xl">Saved questions</h1>
    {query.isPending && <p role="status">Loading saved questions…</p>}
    {query.error && <div><p role="alert">Could not load saved questions.</p><button className="btn btn-ghost" onClick={()=>void query.refetch()}>Retry</button></div>}
    {query.data && <>
      {query.data.items.length === 0 && <p>No saved questions on this page.</p>}
      <ul className="mt-6 space-y-4">{query.data.items.map(item=><Note key={item.id} item={item} />)}</ul>
      <div className="mt-4 flex gap-4"><button className="btn btn-ghost" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous page</button>
        <p>Page {page} · {query.data.total} saved questions</p>
        <button className="btn btn-ghost" disabled={page*20>=query.data.total} onClick={()=>setPage(p=>p+1)}>Next page</button></div>
    </>}
  </AppShell>;
}
function Note({item}:{item:StudyQuestion}) {
  const [note,setNote]=useState(item.note);
  const client=useQueryClient();
  const save=useMutation({mutationFn:()=>Api.updateStudyQuestion(item.id,note),onSuccess:()=>client.invalidateQueries({queryKey:["study"]})});
  const remove=useMutation({mutationFn:()=>Api.deleteStudyQuestion(item.id),onSuccess:()=>client.invalidateQueries({queryKey:["study"]})});
  return <li className="card-surface p-5">
    <p className="whitespace-pre-wrap">{item.prompt}</p>
    <Link to="/report" search={{interviewId:item.interviewId}}>Review source report</Link>
    <form className="mt-3" onSubmit={event=>{event.preventDefault();save.mutate();}}>
      <label className="block">Private note<textarea className="mt-2 w-full rounded border bg-background p-3" maxLength={4000} value={note}
        onChange={event=>{save.reset();setNote(event.target.value);}} /></label>
      <button className="btn btn-primary" disabled={save.isPending || remove.isPending}>{save.isPending ? "Saving…" : "Save note"}</button>
      <button className="btn btn-ghost" type="button" disabled={remove.isPending || save.isPending} onClick={()=>remove.mutate()}>Remove saved question</button>
      {save.isSuccess && <p role="status">Note saved.</p>}
      {(save.error || remove.error) && <p role="alert">Could not update saved question. Your edits are retained; try again.</p>}
    </form>
  </li>;
}
