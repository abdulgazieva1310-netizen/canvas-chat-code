import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Api } from "@/lib/api/client";

const categories = [
  ["incorrect", "Incorrect"],
  ["unclear", "Unclear"],
  ["irrelevant", "Irrelevant"],
  ["wrong_language", "Wrong language"],
  ["other", "Other"],
] as const;

export function EvaluationFeedback({ interviewId, answerId }: { interviewId: string; answerId: string }) {
  const queryClient = useQueryClient();
  const key = ["evaluation-feedback", interviewId, answerId];
  const query = useQuery({ queryKey: key, queryFn: () => Api.getEvaluationFeedback(interviewId, answerId), retry: false });
  const [rating, setRating] = useState<"helpful" | "needs_review" | "">("");
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  useEffect(() => {
    if (!query.data) return;
    setRating(query.data.rating ?? "");
    setCategory(query.data.category ?? "");
    setComment(query.data.comment ?? "");
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => Api.saveEvaluationFeedback(interviewId, answerId, {
      rating: rating as "helpful" | "needs_review",
      category: rating === "needs_review" ? category as "incorrect" | "unclear" | "irrelevant" | "wrong_language" | "other" : null,
      comment: comment || null,
    }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const remove = useMutation({
    mutationFn: () => Api.deleteEvaluationFeedback(interviewId, answerId),
    onSuccess: () => { setRating(""); setCategory(""); setComment(""); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  if (query.isPending) return <p role="status">Loading private feedback…</p>;
  if (query.isError) return <div role="status"><p>Feedback controls are unavailable.</p><button type="button" className="btn btn-ghost" onClick={() => void query.refetch()}>Retry</button></div>;
  return <section className="rounded-lg border p-3" aria-label="Private evaluation feedback">
    <h3 className="font-semibold">Private feedback on this evaluation</h3>
    <p className="text-xs text-muted-foreground">Visible only to you. This does not change your score or retrain the evaluator.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost" aria-pressed={rating === "helpful"} onClick={() => { setRating("helpful"); setCategory(""); }}>Helpful</button>
      <button type="button" className="btn btn-ghost" aria-pressed={rating === "needs_review"} onClick={() => setRating("needs_review")}>Needs review</button>
    </div>
    {rating === "needs_review" && <label className="mt-2 block">Category
      <select className="field mt-1" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">Choose a category</option>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>}
    <label className="mt-2 block">Comment (optional, up to 1000 characters)
      <textarea className="field mt-1 w-full" maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
    </label>
    <div className="mt-2 flex gap-2">
      <button type="button" className="btn btn-primary" disabled={!rating || (rating === "needs_review" && !category) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save feedback"}</button>
      {query.data.rating && <button type="button" className="btn btn-ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove feedback</button>}
    </div>
    {(save.isError || remove.isError) && <p role="alert">Feedback could not be saved. Your text is still here; please retry.</p>}
    {save.isSuccess && <p role="status">Feedback saved.</p>}
  </section>;
}
