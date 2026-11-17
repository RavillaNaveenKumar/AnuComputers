"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CirclePlus, Pencil, Save, Trash2, X } from "lucide-react";

type Role = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  parentId: string | null;
  _count: { children: number; userAssignments: number };
};
type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  hierarchyRoleId: string | null;
  hierarchyRole: { id: string; name: string } | null;
};
type RoleNode = Role & { children: RoleNode[] };
type Editor = { roleId: string | null; name: string; description: string; parentId: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = body.error;
      if (typeof error === "string") message = error;
      else if (typeof error === "object" && error !== null && "formErrors" in error) {
        const formErrors = error.formErrors;
        if (Array.isArray(formErrors) && typeof formErrors[0] === "string") message = formErrors[0];
      }
    }
    throw new Error(message);
  }
  return body as T;
}

export function CrmRoleHierarchyManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;

  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ roles: Role[]; users: User[] }>("/api/crm-setup/role-hierarchy");
      setRoles(result.roles);
      setUsers(result.users);
      setSelectedRoleId((current) => result.roles.some((role) => role.id === current) ? current : result.roles[0]?.id || "");
      setSelectedUserId((current) => result.users.some((user) => user.id === current) ? current : result.users[0]?.id || "");
      setExpandedIds((current) => current.size ? current : new Set(result.roles.map((role) => role.id)));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the role hierarchy.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const roleTree = useMemo(() => {
    const nodes = new Map(roles.map((role) => [role.id, { ...role, children: [] as RoleNode[] }]));
    const roots: RoleNode[] = [];
    for (const role of roles) {
      const node = nodes.get(role.id);
      if (!node) continue;
      const parent = role.parentId ? nodes.get(role.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const sortNodes = (items: RoleNode[]) => {
      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const item of items) sortNodes(item.children);
    };
    sortNodes(roots);
    return roots;
  }, [roles]);

  const descendantIds = useMemo(() => {
    const descendants = new Set<string>();
    if (!editor?.roleId) return descendants;
    const pending = roles.filter((role) => role.parentId === editor.roleId).map((role) => role.id);
    while (pending.length) {
      const id = pending.pop();
      if (!id || descendants.has(id)) continue;
      descendants.add(id);
      pending.push(...roles.filter((role) => role.parentId === id).map((role) => role.id));
    }
    return descendants;
  }, [editor?.roleId, roles]);

  function showCreate() {
    setError("");
    setEditor({ roleId: null, name: "", description: "", parentId: selectedRole?.id || "" });
  }

  function showEdit(role: Role) {
    setError("");
    setEditor({ roleId: role.id, name: role.name, description: role.description || "", parentId: role.parentId || "" });
  }

  async function saveRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await requestJson<Role>("/api/crm-setup/role-hierarchy/roles", {
        method: editor.roleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editor.roleId ? { roleId: editor.roleId } : {}),
          name: editor.name,
          description: editor.description || null,
          parentId: editor.parentId || null,
        }),
      });
      setEditor(null);
      await load();
      setSelectedRoleId(saved.id);
      setMessage(`${saved.name} ${editor.roleId ? "updated" : "created"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this role.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRole(role: Role) {
    if (role.builtIn || !window.confirm(`Delete the ${role.name} role?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await requestJson("/api/crm-setup/role-hierarchy/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: role.id }),
      });
      setSelectedRoleId("");
      await load();
      setMessage(`${role.name} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this role.");
    } finally {
      setSaving(false);
    }
  }

  async function assignUser(roleId: string | null) {
    if (!selectedUser) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await requestJson("/api/crm-setup/role-hierarchy/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id, hierarchyRoleId: roleId }),
      });
      await load();
      setMessage(`${selectedUser.name}'s hierarchy role was updated.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this role assignment.");
    } finally {
      setSaving(false);
    }
  }

  function renderNode(role: RoleNode, depth = 0): React.ReactNode {
    const expanded = expandedIds.has(role.id);
    return <li className="crm-hierarchy-tree-item" role="treeitem" aria-selected={selectedRoleId === role.id} aria-expanded={role.children.length ? expanded : undefined} key={role.id}>
      <div className={`crm-hierarchy-node${selectedRoleId === role.id ? " active" : ""}`} style={{ paddingLeft: `${12 + depth * 20}px` }}>
        <button className="icon-button crm-hierarchy-expand" aria-label={`${expanded ? "Collapse" : "Expand"} ${role.name}`} disabled={!role.children.length} onClick={() => setExpandedIds((current) => {
          const next = new Set(current);
          if (next.has(role.id)) next.delete(role.id);
          else next.add(role.id);
          return next;
        })}>{role.children.length ? expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null}</button>
        <button className="crm-hierarchy-select" onClick={() => setSelectedRoleId(role.id)}>
          <strong>{role.name}</strong><small>{role._count.userAssignments} user{role._count.userAssignments === 1 ? "" : "s"}{role.builtIn ? " · built-in" : ""}</small>
        </button>
        <button className="icon-button" aria-label={`Edit ${role.name}`} onClick={() => showEdit(role)}><Pencil size={14} /></button>
      </div>
      {expanded && role.children.length > 0 && <ul role="group">{role.children.map((child) => renderNode(child, depth + 1))}</ul>}
    </li>;
  }

  return <section className="crm-config-panel">
    <div className="crm-config-heading">
      <div><h2>Roles &amp; Role Hierarchy</h2><p>Set reporting relationships and assign hierarchy roles. Sharing rules and object defaults can use this hierarchy to grant record access.</p></div>
      <button className="button button-primary" disabled={saving} onClick={showCreate}><CirclePlus size={15} /> New role</button>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    {editor && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) setEditor(null);
    }}>
      <section className="panel dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-hierarchy-dialog-title">
        <div className="crm-dialog-header"><div><span className="eyebrow">ROLE HIERARCHY</span><h2 id="crm-hierarchy-dialog-title">{editor.roleId ? "Edit role" : "Create role"}</h2></div>
          <button className="icon-button" aria-label="Close dialog" disabled={saving} onClick={() => setEditor(null)}><X size={18} /></button>
        </div>
        <form className="form-grid crm-setup-form" onSubmit={(event) => void saveRole(event)}>
          <label className="field"><span>Role name *</span><input value={editor.name} required maxLength={80} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
          <label className="field"><span>Description</span><input value={editor.description} maxLength={500} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
          <label className="field"><span>Reports to</span><select value={editor.parentId} onChange={(event) => setEditor({ ...editor, parentId: event.target.value })}>
            <option value="">No parent (top level)</option>
            {roles.filter((role) => role.id !== editor.roleId && !descendantIds.has(role.id)).map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
          </select></label>
          <div className="form-actions field-full"><button type="button" className="button button-quiet" disabled={saving} onClick={() => setEditor(null)}>Cancel</button><button className="button button-primary" disabled={saving}><Save size={14} />{saving ? "Saving…" : "Save role"}</button></div>
        </form>
      </section>
    </div>}
    <div className="crm-hierarchy-layout">
      <section className="panel crm-permissions-panel">
        <div className="crm-panel-heading"><div><h3>Organization hierarchy</h3><p>Expand or collapse role branches. Select a role to inspect and assign users.</p></div></div>
        {roleTree.length ? <ul className="crm-hierarchy-tree" role="tree" aria-label="Role hierarchy">{roleTree.map((role) => renderNode(role))}</ul> : <p className="panel-empty-copy">No hierarchy roles are configured.</p>}
      </section>
      <section className="panel crm-permissions-panel">
        <div className="crm-panel-heading"><div><h3>{selectedRole?.name || "Role details"}</h3><p>{selectedRole?.description || "Select a role in the hierarchy to view and manage its assignments."}</p></div></div>
        {selectedRole && <div className="crm-hierarchy-details">
          <p><strong>Reports to:</strong> {roles.find((role) => role.id === selectedRole.parentId)?.name || "No parent"}</p>
          <p><strong>Direct reports:</strong> {selectedRole._count.children} · <strong>Assigned users:</strong> {selectedRole._count.userAssignments}</p>
          <div className="crm-config-actions">
            <button className="button button-outline" disabled={saving} onClick={() => showEdit(selectedRole)}><Pencil size={14} /> Edit role</button>
            {!selectedRole.builtIn && <button className="button button-outline" disabled={saving || selectedRole._count.children > 0 || selectedRole._count.userAssignments > 0} title={selectedRole._count.children || selectedRole._count.userAssignments ? "Reassign users and child roles before deletion." : undefined} onClick={() => void deleteRole(selectedRole)}><Trash2 size={14} /> Delete role</button>}
          </div>
          <label className="field"><span>Assign user</span><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
            <option value="">Select a user…</option>
            {users.map((user) => <option value={user.id} key={user.id}>{user.name} · {user.email}{user.active ? "" : " · inactive"}</option>)}
          </select></label>
          {selectedUser && <div className="crm-hierarchy-assignment">
            <span>Current role: <strong>{selectedUser.hierarchyRole?.name || "Unassigned"}</strong></span>
            {selectedUser.hierarchyRoleId !== selectedRole.id
              ? <button className="button button-primary" disabled={saving} onClick={() => void assignUser(selectedRole.id)}>Assign to {selectedRole.name}</button>
              : <button className="button button-outline" disabled={saving} onClick={() => void assignUser(null)}>Remove assignment</button>}
          </div>}
        </div>}
      </section>
    </div>
  </section>;
}
