import { useMutation } from "@tanstack/react-query";
import { saveDownload } from "@/lib/download";

export function DownloadButton({ label, filename, load }: {
  label: string; filename: string; load: () => Promise<Blob>;
}) {
  const download = useMutation({ mutationFn: async () => saveDownload(await load(), filename) });
  return <div>
    <button type="button" className="btn btn-ghost" disabled={download.isPending}
      onClick={() => download.mutate()}>{download.isPending ? "Downloading…" : label}</button>
    {download.error && <p role="alert">Download failed. Please try again.</p>}
  </div>;
}
