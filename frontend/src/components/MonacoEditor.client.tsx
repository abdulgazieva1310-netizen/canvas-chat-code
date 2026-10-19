import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/features/clipboard/register.js";
import "monaco-editor/features/indentation/register.js";
import "monaco-editor/features/bracketMatching/register.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/features/wordOperations/register.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/java/register.js";
import "monaco-editor/languages/definitions/cpp/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { CodeEditorProps } from "./CodeEditor";

const browser = self as unknown as { MonacoEnvironment: { getWorker: () => Worker } };
browser.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export default function MonacoEditor({
  language,
  path,
  value,
  readOnly,
  onChange,
}: CodeEditorProps) {
  return (
    <Editor
      language={language}
      path={path}
      value={value}
      height="360px"
      theme="vs-dark"
      onChange={(code) => {
        if (!readOnly) onChange(code ?? "");
      }}
      loading={<p role="status">Loading code editor…</p>}
      options={{
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: "on",
        scrollBeyondLastLine: false,
        ariaLabel: "Code answer",
      }}
    />
  );
}
