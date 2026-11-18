"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function useLeadRequest() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(endpoint: string, method: "PATCH" | "POST", body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Please review the details and try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Request could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, submit };
}

export function LeadAssignmentForm({ id, assigneeId, staff }: { id: string; assigneeId: string | null; staff: { id: string; name: string }[] }) {
  const { error, busy, submit } = useLeadRequest();
  const [value, setValue] = useState(assigneeId || "");
  return <form className="compact-form" onSubmit={(event) => {
    event.preventDefault();
    void submit(`/api/leads/${id}`, "PATCH", { assigneeId: value || null });
  }}>
    <label className="field"><span>Assign owner</span><select value={value} onChange={(event) => setValue(event.target.value)}><option value="">Unassigned</option>{staff.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
    <button className="button button-outline" disabled={busy}>{busy ? "Saving…" : "Save assignment"}</button>
    {error && <small className="inline-error">{error}</small>}
  </form>;
}

export function LeadConversionForm({ id, name, email, phone, customers, possibleMatches = [], linkedCustomerId = null }: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  customers: { id: string; name: string; phone: string | null; email: string | null }[];
  possibleMatches?: { id: string; name: string; phone: string | null; email: string | null }[];
  linkedCustomerId?: string | null;
}) {
  const { error, busy, submit } = useLeadRequest();
  const [mode, setMode] = useState(customers.length ? "existing" : "new");
  const [customerId, setCustomerId] = useState(linkedCustomerId || customers[0]?.id || "");
  const [customerName, setCustomerName] = useState(name);
  return <div className="convert-panel">
    {possibleMatches.length > 0 && <div className="duplicate-notice"><strong>Possible customer matches</strong><span>Review these records before creating a new customer. No records are merged automatically.</span><ul>{possibleMatches.map((customer) => <li key={customer.id}>{customer.name} · {customer.phone || customer.email || "No contact details"}</li>)}</ul></div>}
    <form className="compact-form" onSubmit={(event) => {
      event.preventDefault();
      void submit(`/api/leads/${id}/convert`, "POST", mode === "existing"
        ? { mode, customerId }
        : { mode, customer: { name: customerName, kind: "BUSINESS", email: email || "", phone: phone || "" } });
    }}>
      <label className="field"><span>Conversion choice</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="existing">Link existing customer</option><option value="new">Create a new customer</option></select></label>
      {mode === "existing" ? <label className="field"><span>Customer *</span><select value={customerId} required onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} · {customer.phone || customer.email || "No contact"}</option>)}</select></label> :
        <label className="field"><span>New customer name *</span><input value={customerName} required onChange={(event) => setCustomerName(event.target.value)} /></label>}
      <button className="button button-primary" disabled={busy || (mode === "existing" && !customers.length)}>{busy ? "Converting…" : "Convert to customer"}</button>
      {error && <small className="inline-error">{error}</small>}
    </form>
  </div>;
}
