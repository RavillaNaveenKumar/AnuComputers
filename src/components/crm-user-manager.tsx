"use client";

import { useCallback, useEffect, useState } from "react";
import { CirclePlus, Mail, Search, UserRound, X } from "lucide-react";

const roleOptions = [
  "ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "DISPATCH",
  "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN",
] as const;
type UserRole = typeof roleOptions[number];
type UserRow = {
  id: string;
  username: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: UserRole;
  profile: { id: string; name: string };
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};
type UserPage = { users: UserRow[]; page: number; pageSize: number; total: number; pageCount: number };
type ProfileOption = { id: string; name: string; allowLogin: boolean };

const roleLabel = (role: string) => role.replaceAll("_", " ");
const roleProfileName: Record<UserRole, string> = {
  ADMIN: "System Administrator",
  SALES_MANAGER: "Sales Manager",
  SALES_EXECUTIVE: "Sales User",
  DISPATCH: "Dispatch",
  SERVICE_MANAGER: "Service Manager",
  SERVICE_AGENT: "Service User",
  TECHNICIAN: "Technician",
};

async function responseMessage(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : `Request failed (${response.status}).`;
}

function localDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function CrmUserManager() {
  const [result, setResult] = useState<UserPage>({ users: [], page: 1, pageSize: 25, total: 0, pageCount: 0 });
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "25", status });
    if (search.trim()) query.set("q", search.trim());
    if (role) query.set("role", role);
    try {
      const response = await fetch(`/api/crm-setup/users?${query}`);
      if (!response.ok) throw new Error(await responseMessage(response));
      setResult(await response.json() as UserPage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, [page, role, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    fetch("/api/crm-setup/profiles/options")
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        const data = await response.json() as { profiles: ProfileOption[] };
        setProfiles(data.profiles);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load profiles."));
  }, []);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/crm-setup/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const created = await response.json() as { user: UserRow };
      setDialog(null);
      setMessage(`Created ${created.user.firstName} ${created.user.lastName}. Sending the password setup link…`);
      const resetResponse = await fetch(`/api/crm-setup/users/${created.user.id}/reset-password`, { method: "POST" });
      if (!resetResponse.ok) {
        setMessage("User created, but the setup email was not sent. Check SMTP settings and use Send reset link.");
      } else {
        setMessage("User created and password setup email sent.");
      }
      setPage(1);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create user.");
    } finally {
      setSaving(false);
    }
  }

  async function saveUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      userId: editing.id,
      firstName: form.get("firstName"),
      lastName: form.get("lastName"),
      username: form.get("username"),
      email: form.get("email"),
      phone: form.get("phone") || null,
      role: form.get("role"),
      profileId: form.get("profileId"),
      active: form.get("active") === "on",
      mustChangePassword: form.get("mustChangePassword") === "on",
    };
    if (!payload.active && editing.active && !window.confirm("Deactivate this user and revoke all active sessions?")) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/crm-setup/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setDialog(null);
      setEditing(null);
      setMessage("User access updated.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update user.");
    } finally {
      setSaving(false);
    }
  }

  async function sendReset(user: UserRow) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/crm-setup/users/${user.id}/reset-password`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setMessage(`Password setup/reset email sent to ${user.email}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the password reset email.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="crm-config-panel">
    <div className="crm-config-heading">
      <div><h2>Users</h2><p>Create staff accounts, manage access, and send secure password setup links.</p></div>
      <button className="button button-primary" disabled={!profiles.length} onClick={() => { setEditing(null); setDialog("create"); setError(""); }}>
        <CirclePlus size={15} /> New user
      </button>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    <div className="crm-manager-filters">
      <label className="crm-manager-search"><Search size={16} /><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search name, username, or email" aria-label="Search users" /></label>
      <label><span>Status</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="all">All users</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label><span>Role</span><select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}><option value="">All roles</option>{roleOptions.map((item) => <option value={item} key={item}>{roleLabel(item)}</option>)}</select></label>
    </div>
    <div className="panel crm-config-table">
      {loading ? <p className="panel-empty-copy">Loading users…</p> : result.users.length ? <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>User</th><th>Email / contact</th><th>Role / Profile</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead>
          <tbody>{result.users.map((user) => <tr key={user.id}>
            <td><strong>{user.firstName || user.lastName ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : user.email}</strong><span className="table-sub">{user.username || "Username not set"}</span></td>
            <td>{user.email}<span className="table-sub">{user.phone || "No phone"}</span></td>
            <td>{roleLabel(user.role)}<span className="table-sub">{user.profile.name}</span></td>
            <td><span className={`status-badge ${user.active ? "status-active" : "status-inactive"}`}>{user.active ? "Active" : "Inactive"}</span>{user.mustChangePassword && <span className="table-sub">Password setup required</span>}</td>
            <td>{localDate(user.lastLoginAt)}</td>
            <td><div className="crm-config-actions">
              <button className="button button-small button-outline" disabled={!profiles.length || saving} onClick={() => { setEditing(user); setDialog("edit"); setError(""); }}>Edit</button>
              <button className="icon-button" aria-label={`Send password reset to ${user.email}`} disabled={!user.active || saving} onClick={() => void sendReset(user)}><Mail size={15} /></button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="panel-empty-copy">No users match these filters.</p>}
      <div className="crm-config-pagination"><span>{result.total} users · Page {result.page} of {Math.max(result.pageCount, 1)}</span><div>
        <button className="button button-small button-outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
        <button className="button button-small button-outline" disabled={page >= result.pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div></div>
    </div>

    {dialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialog(null); }}>
      <section className="panel dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-user-dialog-title">
        <div className="crm-dialog-header"><div><span className="eyebrow"><UserRound size={14} /> USER MANAGEMENT</span><h2 id="crm-user-dialog-title">{dialog === "create" ? "Create user" : "Edit user"}</h2></div><button className="icon-button" aria-label="Close dialog" disabled={saving} onClick={() => setDialog(null)}><X size={18} /></button></div>
        <form className="form-grid crm-setup-form" onSubmit={dialog === "create" ? createUser : saveUser}>
          <label className="field"><span>First name *</span><input name="firstName" required maxLength={80} defaultValue={editing?.firstName || ""} /></label>
          <label className="field"><span>Last name *</span><input name="lastName" required maxLength={80} defaultValue={editing?.lastName || ""} /></label>
          <label className="field"><span>Username *</span><input name="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" defaultValue={editing?.username || ""} autoCapitalize="none" /></label>
          <label className="field"><span>Email *</span><input name="email" type="email" required defaultValue={editing?.email || ""} /></label>
          <label className="field"><span>Phone</span><input name="phone" type="tel" maxLength={40} defaultValue={editing?.phone || ""} /></label>
          <label className="field"><span>Role *</span><select name="role" required defaultValue={editing?.role || "SALES_EXECUTIVE"}>{roleOptions.map((item) => <option value={item} key={item}>{roleLabel(item)}</option>)}</select></label>
          <label className="field"><span>Profile *</span><select name="profileId" required defaultValue={editing?.profile.id || profiles.find((profile) => profile.name === roleProfileName[editing?.role || "SALES_EXECUTIVE"])?.id || ""}>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}{profile.allowLogin ? "" : " · login disabled"}</option>)}</select></label>
          {dialog === "edit" && editing && <>
            <label className="crm-required-toggle"><input name="active" type="checkbox" defaultChecked={editing.active} /><span>Account active</span></label>
            <label className="crm-required-toggle"><input name="mustChangePassword" type="checkbox" defaultChecked={editing.mustChangePassword} /><span>Require password change</span></label>
          </>}
          {dialog === "create" && <p className="crm-dialog-note field-full">A random credential is generated and never displayed. A secure password setup link will be emailed after creation.</p>}
          <div className="form-actions field-full"><button type="button" className="button button-quiet" disabled={saving} onClick={() => setDialog(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : dialog === "create" ? "Create user" : "Save user"}</button></div>
        </form>
      </section>
    </div>}
  </section>;
}

export function SmtpConnectionTest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function test() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/crm-setup/security/test-email", { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setMessage("SMTP verified and a test email was sent to your signed-in administrator email.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "SMTP verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel crm-security-email">
    <div className="crm-panel-heading"><div><h3>Email delivery</h3><p>SMTP credentials are read only from server environment variables and are never returned by the API.</p></div></div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    <div className="crm-config-actions"><button className="button button-primary" disabled={busy} onClick={() => void test()}>{busy ? "Verifying and sending…" : "Test SMTP connection and email"}</button></div>
  </section>;
}
