"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

export type FormField = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "tel" | "number" | "date" | "textarea" | "select";
  required?: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
  defaultValue?: string;
};

export function RecordForm({
  title,
  endpoint,
  fields,
  submitLabel = "Save record",
  method = "POST",
}: {
  title: string;
  endpoint: string;
  fields: FormField[];
  submitLabel?: string;
  method?: "POST" | "PATCH";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Please review the form and try again.");
        return;
      }
      form.reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save this record. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="button button-primary" onClick={() => setOpen(true)}><Plus size={17} /> {title}</button>
      {open && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="record-form-title">
          <div className="dialog-header"><div><div className="eyebrow">NEW RECORD</div><h2 id="record-form-title">{title}</h2></div><button className="icon-button" aria-label="Close" onClick={() => setOpen(false)}><X size={20} /></button></div>
          <form onSubmit={submit}>
            <div className="form-grid">
              {fields.map((field) => <label className={`field ${field.type === "textarea" ? "field-full" : ""}`} key={field.name}>
                <span>{field.label}{field.required && <em> *</em>}</span>
                {field.type === "textarea" ? <textarea name={field.name} required={field.required} placeholder={field.placeholder} defaultValue={field.defaultValue} rows={3} /> :
                  field.type === "select" ? <select name={field.name} required={field.required} defaultValue={field.defaultValue || ""}>
                    <option value="">Select…</option>
                    {field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select> :
                  <input name={field.name} type={field.type || "text"} required={field.required} placeholder={field.placeholder} defaultValue={field.defaultValue} min={field.type === "number" ? "0" : undefined} />}
              </label>)}
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="dialog-footer"><button className="button button-quiet" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
          </form>
        </section>
      </div>}
    </>
  );
}

export function InlineAction({
  endpoint,
  body,
  label,
  confirmMessage,
}: {
  endpoint: string;
  body: Record<string, string>;
  label: string;
  confirmMessage?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError("");
    const response = await fetch(endpoint, { method: endpoint.endsWith("/deliver") ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) setError(typeof result.error === "string" ? result.error : "Action could not be completed.");
    else router.refresh();
  }
  return <span className="inline-action"><button className="button button-small button-outline" onClick={run}>{label}</button>{error && <small className="inline-error">{error}</small>}</span>;
}
