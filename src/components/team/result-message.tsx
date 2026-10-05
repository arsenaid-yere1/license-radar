"use client";
import { useEffect, useRef } from "react";
export function ResultMessage({
  state,
}: {
  state: { status: string; message?: string };
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message) ref.current?.focus();
  }, [state]);
  return state.message ? (
    <p
      role="status"
      tabIndex={-1}
      ref={ref}
      className={state.status === "success" ? "success" : "error"}
    >
      {state.message}
    </p>
  ) : null;
}
