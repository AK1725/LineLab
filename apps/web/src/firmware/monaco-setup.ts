"use client";

// Monaco bundled locally (no CDN): the editor API plus C/C++ highlighting, with its worker.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/cpp/register";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker };
  }
}

window.MonacoEnvironment = {
  getWorker: () => new Worker(new URL("./monaco.worker.ts", import.meta.url), { type: "module" }),
};
loader.config({ monaco });

export { monaco };
