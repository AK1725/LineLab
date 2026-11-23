import type { Metadata } from "next";
import { Suspense } from "react";
import Editor from "../../../src/editor/editor";

export const metadata: Metadata = { title: "Editor" };

export default function EditPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading editor…</p>}>
      <Editor />
    </Suspense>
  );
}
