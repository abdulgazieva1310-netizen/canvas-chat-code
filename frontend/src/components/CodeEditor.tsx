import { useEffect, useState, type ComponentType } from "react";
import { createClientOnlyFn } from "@tanstack/react-start";

const loadEditor = createClientOnlyFn(() => import("./MonacoEditor.client"));

export type CodingLanguage = "python" | "java" | "cpp";
export interface CodeEditorProps {
  language: CodingLanguage;
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}

export default function CodeEditor(props: CodeEditorProps) {
  const [Editor, setEditor] = useState<ComponentType<CodeEditorProps> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Monaco accesses browser globals; load it only after client mount, not SSR.
    loadEditor().then(
      (module) => {
        if (mounted) setEditor(() => module.default);
      },
      () => {
        if (mounted) setFailed(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  if (Editor) return <Editor {...props} />;
  return (
    <div className="w-full">
      <p role="status" className="mb-2 text-sm text-muted-foreground">
        {failed
          ? "Editor unavailable. You can still enter and submit code below."
          : "Loading code editor…"}
      </p>
      <textarea
        aria-label="Code answer"
        spellCheck={false}
        rows={14}
        disabled={props.readOnly}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-lg border bg-background p-3 font-mono text-sm"
      />
    </div>
  );
}
