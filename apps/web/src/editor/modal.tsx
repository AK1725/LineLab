"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A native modal dialog (focus trap, Escape and backdrop handled by the browser). */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      d?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-full max-w-2xl rounded-xl border border-border bg-card p-0 text-fg shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center border-b border-border px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-muted hover:text-fg"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}
