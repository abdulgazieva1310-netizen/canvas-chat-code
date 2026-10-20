import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Api } from "@/lib/api/client";
export function DeleteAccount() {
  const [open,setOpen]=useState(false);
  const [password,setPassword]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const client=useQueryClient();
  const navigate=useNavigate();
  const deletion=useMutation({mutationFn:()=>Api.deleteAccount(password),onSuccess:async()=>{
    setPassword("");await client.cancelQueries();await navigate({to:"/login",search:{redirect:"/"},replace:true});client.clear();
  }});
  return <section className="card-surface mt-6 max-w-xl p-7" aria-label="Delete account">
    <h2 className="text-xl">Delete account permanently</h2>
    <p>This permanently removes your account, interviews, feedback and study notes. Recording access ends immediately; file deletion is retried if storage is temporarily unavailable. Download your account archive first if you want a copy.</p>
    {!open ? <button type="button" className="btn btn-ghost" onClick={()=>setOpen(true)}>Delete my account</button> :
      <form onSubmit={event=>{event.preventDefault();if(confirmation==="DELETE" && password && !deletion.isPending)deletion.mutate();}}>
        <label className="mt-3 block">Current password<input type="password" autoComplete="current-password" className="mt-2 w-full rounded border bg-background p-3" value={password} required onChange={e=>{deletion.reset();setPassword(e.target.value);}} /></label>
        <label className="mt-3 block">Type DELETE to confirm<input className="mt-2 w-full rounded border bg-background p-3" value={confirmation} onChange={e=>setConfirmation(e.target.value)} /></label>
        <button className="btn btn-primary mt-3" disabled={!password || confirmation!=="DELETE" || deletion.isPending}>{deletion.isPending ? "Deleting account…" : "Permanently delete account"}</button>
        <button type="button" className="btn btn-ghost" disabled={deletion.isPending} onClick={()=>{setOpen(false);setPassword("");setConfirmation("");deletion.reset();}}>Cancel deletion</button>
        {deletion.error && <p role="alert">Could not delete account: {deletion.error.message}. You can retry.</p>}
      </form>}
  </section>;
}
