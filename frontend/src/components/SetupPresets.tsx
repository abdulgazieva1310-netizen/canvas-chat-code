import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Api } from "@/lib/api/client";
import type { InterviewSetup, SetupPreset } from "@/lib/api/types";

type PresetData = Omit<SetupPreset, "id" | "createdAt" | "updatedAt">;
const currentFields = (setup: InterviewSetup): Omit<PresetData, "name"> => ({
  role: setup.role,
  level: setup.level,
  type: setup.type,
  mode: setup.mode,
  input: setup.input,
  questionCount: setup.questionCount,
  language: setup.language,
});

export function SetupPresets({ setup, onApply }: { setup: InterviewSetup; onApply: (preset: SetupPreset) => void }) {
  const client = useQueryClient();
  const sessionReady = client.getQueryData(["history"]) !== undefined;
  const query = useQuery({ queryKey: ["setup-presets"], queryFn: Api.listSetupPresets, retry: false, enabled: sessionReady });
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["setup-presets"] }); };
  const save = useMutation({
    mutationFn: () => renaming
      ? Api.updateSetupPreset(renaming, { ...currentFields(query.data!.items.find((item) => item.id === renaming)!), name })
      : Api.createSetupPreset({ ...currentFields(setup), name }),
    onSuccess: async () => { await refresh(); setName(""); setRenaming(null); setFormOpen(false); setError(null); },
    onError: (reason) => setError(reason.message || "The preset could not be saved. Your name is still here."),
  });
  const update = useMutation({
    mutationFn: (preset: SetupPreset) => Api.updateSetupPreset(preset.id, { name: preset.name, ...currentFields(setup) }),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (reason) => setError(reason.message || "The preset could not be updated. Please retry."),
  });
  const remove = useMutation({ mutationFn: Api.deleteSetupPreset, onSuccess: async () => { setError(null); await refresh(); },
    onError: () => setError("The preset could not be deleted. Please retry.") });
  const beginCreate = () => { setName(""); setRenaming(null); setFormOpen(true); setError(null); };
  const beginRename = (preset: SetupPreset) => { setName(preset.name); setRenaming(preset.id); setFormOpen(true); setError(null); };
  return <section className="card-surface mt-4 space-y-3 p-5" aria-label="Saved setup presets">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl">Saved Setup presets</h2><p className="text-sm text-muted-foreground">Save the current choices without a job description. Up to 20 presets.</p></div>
      <button type="button" className="btn btn-ghost" disabled={(query.data?.items?.length ?? 0) >= 20} onClick={beginCreate}>Save current Setup</button>
    </div>
    {sessionReady && query.isPending && <p role="status">Loading saved presets…</p>}
    {sessionReady && query.isError && <div role="alert"><p>Saved presets could not be loaded.</p><button type="button" className="btn btn-ghost" onClick={() => void query.refetch()}>Retry loading presets</button></div>}
    {query.data?.items?.length === 0 && <p className="text-sm">No saved presets yet.</p>}
    {query.data?.items?.map((preset) => <article key={preset.id} className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-semibold">{preset.name}</p><p className="text-sm text-muted-foreground">{preset.role} · {preset.level} · {preset.type} · {preset.mode} · {preset.questionCount} questions · {preset.language}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => onApply(preset)}>Apply to Setup</button>
          <button type="button" className="btn btn-ghost" disabled={update.isPending} onClick={() => { setError(null); update.mutate(preset); }}>Update from current Setup</button>
          <button type="button" className="btn btn-ghost" onClick={() => beginRename(preset)}>Rename</button>
          <button type="button" className="btn btn-ghost" disabled={remove.isPending} onClick={() => { setError(null); remove.mutate(preset.id); }}>Delete</button>
        </div>
      </div>
      {preset.language === "Russian" && <p className="mt-2 text-sm" role="note">Russian is a preview and requires a supported provider. Applying this preset does not bypass availability checks; select English if the preview is unavailable.</p>}
    </article>)}
    {formOpen && <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => { event.preventDefault(); setError(null); save.mutate(); }}>
      <label className="block">Preset name
        <input className="field mt-1 w-full" required minLength={1} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!renaming && <p className="text-sm text-muted-foreground">This saves the current role, level, type, mode, input, question count and language. Job descriptions stay in saved job targets.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-2"><button className="btn btn-primary" type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : save.isError ? "Retry save" : renaming ? "Save name" : "Save preset"}</button><button className="btn btn-ghost" type="button" onClick={() => { setFormOpen(false); setError(null); }}>Cancel</button></div>
    </form>}
    {error && !formOpen && <p role="alert">{error}</p>}
  </section>;
}
