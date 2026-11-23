"use client";

import dynamic from "next/dynamic";

/** three.js needs the browser, so the viewer is loaded client-side only. */
const ModelViewer = dynamic(() => import("./model-viewer"), {
  ssr: false,
  loading: () => (
    <div
      data-testid="model-viewer"
      data-status="loading"
      className="aspect-[4/3] w-full animate-pulse rounded-lg border border-border bg-card"
    />
  ),
});

export default ModelViewer;
