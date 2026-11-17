"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RecordForm } from "@/components/record-form";

const roles = ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "DISPATCH", "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN"];

export function StaffCreateForm() {
  return <RecordForm title="Add staff account" endpoint="/api/staff" fields={[
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Work email", type: "email", required: true },
    { name: "password", label: "Temporary password (12+ characters)", type: "password", required: true },
    { name: "role", label: "Role", type: "select", required: true, defaultValue: "SALES_EXECUTIVE", options: roles.map((role) => ({ label: role.replaceAll("_", " "), value: role })) },
  ]} />;
}

export function StaffRoleEditor({ staff }: { staff: { id: string; role: string; active: boolean } }) {
  const [role, setRole] = useState(staff.role);
  const [active, setActive] = useState(staff.active);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/staff", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: staff.id, role, active }) });
      const result = await response.json();
      if (!response.ok) setError(typeof result.error === "string" ? result.error : "Could not update this account.");
      else router.refresh();
    } catch { setError("Could not update this account."); }
    finally { setSaving(false); }
  }
  return <div className="staff-editor">
    <select aria-label="Staff role" value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select>
    <label className="checkbox-label"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active</label>
    <button className="button button-small button-outline" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
    {error && <small className="inline-error">{error}</small>}
  </div>;
}

export function BusinessSettingsForm({ timezone, defaultWarrantyMonths }: { timezone: string; defaultWarrantyMonths: number }) {
  const [zone, setZone] = useState(timezone);
  const [warranty, setWarranty] = useState(String(defaultWarrantyMonths));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: zone, defaultWarrantyMonths: Number(warranty) }) });
      const result = await response.json();
      if (!response.ok) setError(typeof result.error === "string" ? result.error : "Settings could not be saved.");
      else setMessage("Settings saved.");
    } catch { setError("Settings could not be saved."); }
    finally { setSaving(false); }
  }
  return <form className="inline-form" onSubmit={save}><div className="form-grid">
    <label className="field"><span>Business timezone</span><input value={zone} onChange={(event) => setZone(event.target.value)} required placeholder="Asia/Kolkata" /></label>
    <label className="field"><span>Default product warranty (months)</span><input type="number" min="0" max="1200" value={warranty} onChange={(event) => setWarranty(event.target.value)} required /></label>
  </div>{error && <div role="alert" className="form-error">{error}</div>}{message && <div className="success-message" role="status">{message}</div>}<div className="dialog-footer"><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button></div></form>;
}
