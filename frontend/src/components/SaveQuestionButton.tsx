import { useMutation } from "@tanstack/react-query";
import { Api } from "@/lib/api/client";
export function SaveQuestionButton({ interviewId, questionId }: {interviewId:string; questionId:string}) {
  const save = useMutation({mutationFn:()=>Api.saveStudyQuestion(interviewId,questionId)});
  return <div>
    <button type="button" className="btn btn-ghost" disabled={save.isPending || save.isSuccess} onClick={()=>save.mutate()}>
      {save.isPending ? "Saving question…" : save.isSuccess ? "Question saved" : "Save question for study"}
    </button>
    {save.error && <p role="alert">Could not save question. Please try again.</p>}
  </div>;
}
