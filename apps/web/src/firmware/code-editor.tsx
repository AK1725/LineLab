"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import type { CompileDiagnostic } from "@linelab/schema";
import { useEffect, useRef } from "react";
import { monaco } from "./monaco-setup";
import { useFirmware } from "./store";

type Ed = Parameters<OnMount>[0];

/** Monaco with Arduino (C++) highlighting and compile diagnostics as markers. */
export default function CodeEditor({
  value,
  onChange,
  diagnostics,
  reveal,
}: {
  value: string;
  onChange: (v: string) => void;
  diagnostics: CompileDiagnostic[];
  reveal: { line: number; seq: number } | null;
}) {
  const editor = useRef<Ed | null>(null);
  const dark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "compile",
      diagnostics
        .filter((d) => d.line > 0 && d.file.endsWith(".ino"))
        .map((d) => ({
          startLineNumber: d.line,
          endLineNumber: d.line,
          startColumn: Math.max(1, d.column),
          endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
          message: d.message,
          severity:
            d.severity === "error"
              ? monaco.MarkerSeverity.Error
              : d.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
        })),
    );
  }, [diagnostics]);

  const show = (e: Ed, line: number) => {
    e.revealLineInCenter(line);
    e.setPosition({ lineNumber: line, column: 1 });
  };
  useEffect(() => {
    if (reveal === null || !editor.current) return;
    show(editor.current, reveal.line);
    editor.current.focus();
  }, [reveal]);

  return (
    <Editor
      language="cpp"
      value={value}
      theme={dark ? "vs-dark" : "vs"}
      onChange={(v) => {
        onChange(v ?? "");
      }}
      onMount={(e) => {
        editor.current = e;
        // A line requested before the editor existed (e.g. from a run report link).
        const pending = useFirmware.getState().reveal;
        if (pending) show(e, pending.line);
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
      }}
      loading={<p className="p-4 text-sm text-muted">Loading editor…</p>}
    />
  );
}
