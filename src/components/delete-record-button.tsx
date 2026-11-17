"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteRecordButton({
  endpoint,
  returnTo,
  recordLabel,
}: {
  endpoint: string;
  returnTo: string;
  recordLabel: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete ${recordLabel}? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not delete this record.");
      router.push(returnTo);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this record.");
    } finally {
      setBusy(false);
    }
  }

  return <span className="inline-action">
    <button className="button button-danger" onClick={() => void remove()} disabled={busy}><Trash2 size={15} />{busy ? "Deleting…" : "Delete"}</button>
    {error && <small className="inline-error" role="alert">{error}</small>}
  </span>;
}
