"use client";

import { useEffect, useState } from "react";

type View = "login-history" | "audit-logs" | "effective-permissions";
type LoginEntry = {
  id: string;
  success: boolean;
  identifier: string | null;
  failureReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};
type AuditEntry = {
  id: string;
  source: "CRM_SETUP" | "BUSINESS";
  action: string;
  resourceType: string;
  resourceId: string;
  details: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};
type InspectorUser = { id: string; name: string; email: string; role: string; active: boolean };
type EffectivePermissions = {
  user: {
    name: string;
    email: string;
    role: string;
    active: boolean;
    mustChangePassword: boolean;
    loginPermitted: boolean;
    profile: { name: string; allowLogin: boolean };
    permissionSets: { id: string; name: string }[];
  };
  apps: { id: string; name: string; objects: { id: string; name: string; apiName: string }[] }[];
  objects: {
    id: string;
    apiName: string;
    name: string;
    module: string;
    appAccess: boolean;
    capabilities: { canCreate: boolean; canRead: boolean; canEdit: boolean; canDelete: boolean };
    viewAll: boolean;
    modifyAll: boolean;
    tabVisible: boolean;
    fields: { id: string; apiName: string; label: string; canRead: boolean; canEdit: boolean }[];
  }[];
};

async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : `Request failed (${response.status}).`;
}

function localDate(value: string) {
  return new Date(value).toLocaleString();
}

function permissionMark(value: boolean) {
  return value ? "Allowed" : "Denied";
}

export function CrmSecurityInsightsManager({ view }: { view: View }) {
  const [loginHistory, setLoginHistory] = useState<LoginEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<InspectorUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permissions, setPermissions] = useState<EffectivePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      if (view === "login-history") {
        const response = await fetch("/api/crm-setup/login-history?limit=100");
        if (!response.ok) throw new Error(await responseError(response));
        setLoginHistory(await response.json() as LoginEntry[]);
      } else if (view === "audit-logs") {
        const response = await fetch("/api/crm-setup/audit-logs?limit=100");
        if (!response.ok) throw new Error(await responseError(response));
        setAuditLogs(await response.json() as AuditEntry[]);
      } else if (!selectedUserId) {
        const response = await fetch("/api/crm-setup/effective-permissions");
        if (!response.ok) throw new Error(await responseError(response));
        const result = await response.json() as { users: InspectorUser[] };
        setUsers(result.users);
        setSelectedUserId(result.users[0]?.id ?? "");
        setPermissions(null);
      } else {
        const response = await fetch(`/api/crm-setup/effective-permissions?userId=${encodeURIComponent(selectedUserId)}`);
        if (!response.ok) throw new Error(await responseError(response));
        setPermissions(await response.json() as EffectivePermissions);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load security information.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // Reload when the selected Setup view or inspected user changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedUserId]);

  const title = view === "login-history" ? "Login History" : view === "audit-logs" ? "Audit Logs" : "Effective Permissions";
  const description = view === "login-history"
    ? "Recent authentication attempts recorded by the CRM."
    : view === "audit-logs"
      ? "Recent CRM Setup and business changes, with actor and resource details."
      : "Inspect a user's effective application, object, and field access.";

  return <section className="crm-config-panel">
    <div className="crm-config-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>Refresh</button>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}

    {view === "login-history" && <div className="panel crm-config-table"><div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Time</th><th>User / identifier</th><th>Result</th><th>Reason</th><th>IP address</th><th>Client</th></tr></thead>
        <tbody>{!loading && loginHistory.map((entry) => <tr key={entry.id}>
          <td>{localDate(entry.createdAt)}</td>
          <td>{entry.user?.name ?? entry.identifier ?? "Unknown"}<span className="table-sub">{entry.user?.email ?? entry.identifier ?? "No identifier"}</span></td>
          <td><span className="status-badge">{entry.success ? "Success" : "Failed"}</span></td>
          <td>{entry.failureReason ?? "—"}</td>
          <td>{entry.ipAddress ?? "—"}</td>
          <td title={entry.userAgent ?? ""}>{entry.userAgent ?? "—"}</td>
        </tr>)}</tbody>
      </table>
      {loading && <p className="panel-empty-copy">Loading login history…</p>}
      {!loading && !loginHistory.length && <p className="panel-empty-copy">No login attempts are recorded.</p>}
    </div></div>}

    {view === "audit-logs" && <div className="panel crm-config-table"><div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Source</th><th>Details</th></tr></thead>
        <tbody>{!loading && auditLogs.map((entry) => <tr key={`${entry.source}:${entry.id}`}>
          <td>{localDate(entry.createdAt)}</td>
          <td>{entry.actor?.name ?? "System"}<span className="table-sub">{entry.actor?.email ?? "—"}</span></td>
          <td>{entry.action}</td>
          <td>{entry.resourceType}<span className="table-sub">{entry.resourceId}</span></td>
          <td>{entry.source.replace("_", " ")}</td>
          <td title={JSON.stringify(entry.details ?? {})}>{JSON.stringify(entry.details ?? {})}</td>
        </tr>)}</tbody>
      </table>
      {loading && <p className="panel-empty-copy">Loading audit logs…</p>}
      {!loading && !auditLogs.length && <p className="panel-empty-copy">No audit events are recorded.</p>}
    </div></div>}

    {view === "effective-permissions" && <>
      <div className="crm-manager-filters">
        <label><span>Inspect user</span><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
          {users.map((user) => <option value={user.id} key={user.id}>{user.name} · {user.email}{user.active ? "" : " · inactive"}</option>)}
        </select></label>
      </div>
      {loading ? <p className="panel-empty-copy">Loading effective permissions…</p> : permissions ? <>
        <div className="crm-object-meta">
          <div><span>User</span><strong>{permissions.user.name}</strong></div>
          <div><span>Role / Profile</span><strong>{permissions.user.role.replaceAll("_", " ")} · {permissions.user.profile.name}</strong></div>
          <div><span>Account</span><strong>{permissions.user.active ? "Active" : "Inactive"} · {permissions.user.loginPermitted ? "Login permitted" : "Login blocked"}</strong></div>
          <div><span>Permission Sets</span><strong>{permissions.user.permissionSets.map(({ name }) => name).join(", ") || "None"}</strong></div>
        </div>
        <section className="panel crm-config-table section-spacer">
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Object</th><th>App / tab</th><th>Read</th><th>Create</th><th>Edit</th><th>Delete</th><th>View all</th><th>Modify all</th><th>Field access</th></tr></thead>
            <tbody>{permissions.objects.map((object) => <tr key={object.id}>
              <td><strong>{object.name}</strong><span className="table-sub">{object.apiName} · {object.module}</span></td>
              <td>{permissionMark(object.appAccess)} / {permissionMark(object.tabVisible)}</td>
              <td>{permissionMark(object.capabilities.canRead)}</td>
              <td>{permissionMark(object.capabilities.canCreate)}</td>
              <td>{permissionMark(object.capabilities.canEdit)}</td>
              <td>{permissionMark(object.capabilities.canDelete)}</td>
              <td>{permissionMark(object.viewAll)}</td>
              <td>{permissionMark(object.modifyAll)}</td>
              <td><details><summary>{object.fields.filter(({ canRead }) => canRead).length} readable · {object.fields.filter(({ canEdit }) => canEdit).length} editable</summary>
                <ul>{object.fields.map((field) => <li key={field.id}>{field.label} ({field.apiName}): {field.canRead ? "read" : "hidden"}{field.canEdit ? " / edit" : ""}</li>)}</ul>
              </details></td>
            </tr>)}</tbody>
          </table></div>
        </section>
        <section className="panel crm-config-table section-spacer">
          <div className="crm-panel-heading"><div><h3>Applications</h3><p>Apps and visible object tabs for this user.</p></div></div>
          {permissions.apps.map((app) => <div className="crm-config-row" key={app.id}>
            <span><strong>{app.name}</strong><small>{app.objects.map(({ name }) => name).join(", ") || "No visible tabs"}</small></span>
          </div>)}
          {!permissions.apps.length && <p className="panel-empty-copy">No applications are available to this user.</p>}
        </section>
      </> : !loading && <p className="panel-empty-copy">Select a user to inspect.</p>}
    </>}
  </section>;
}
