"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, CirclePlus, Save, Trash2 } from "lucide-react";

type ObjectGrant = {
  objectId: string;
  canCreate: boolean;
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  viewAll: boolean;
  modifyAll: boolean;
  object: { id: string; name: string; pluralLabel: string; apiName: string };
};
type FieldGrant = {
  fieldId: string;
  canRead: boolean;
  canEdit: boolean;
  field: { id: string; objectId: string; label: string; apiName: string; dataType: string };
};
type AppGrant = { appId: string; canAccess: boolean; app: { id: string; key: string; name: string } };
type TabGrant = {
  appId: string;
  objectId: string;
  visibility: "DEFAULT_ON" | "DEFAULT_OFF";
  app: { id: string; name: string };
  object: { id: string; name: string; pluralLabel: string };
};
type AssignedUser = { id: string; name: string; email: string; role: string; active: boolean };
type PermissionSet = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  objectPermissions: ObjectGrant[];
  fieldPermissions: FieldGrant[];
  appPermissions: AppGrant[];
  tabPermissions: TabGrant[];
  assignments: { userId: string; user: AssignedUser }[];
};
type RegistryObject = {
  id: string;
  name: string;
  pluralLabel: string;
  apiName: string;
  fields: { id: string; label: string; apiName: string; dataType: string }[];
};
type App = {
  id: string;
  key: string;
  name: string;
  assignments: { objectId: string; object: { id: string; name: string; pluralLabel: string } }[];
};
type User = AssignedUser & { profile: { name: string } };

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

export function CrmPermissionSetManager() {
  const [permissionSets, setPermissionSets] = useState<PermissionSet[]>([]);
  const [objects, setObjects] = useState<RegistryObject[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [permissionSetId, setPermissionSetId] = useState("");
  const [objectId, setObjectId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [createMode, setCreateMode] = useState<"new" | "clone" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const permissionSet = permissionSets.find((item) => item.id === permissionSetId) || permissionSets[0] || null;
  const selectedObject = objects.find((object) => object.id === objectId) || objects[0] || null;
  const assignedUserIds = new Set(permissionSet?.assignments.map(({ userId }) => userId) || []);

  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ permissionSets: PermissionSet[]; objects: RegistryObject[]; apps: App[]; users: User[] }>("/api/crm-setup/permission-sets");
      setPermissionSets(result.permissionSets);
      setObjects(result.objects);
      setApps(result.apps);
      setUsers(result.users);
      setPermissionSetId((current) => result.permissionSets.some((item) => item.id === current) ? current : result.permissionSets[0]?.id || "");
      setObjectId((current) => result.objects.some((object) => object.id === current) ? current : result.objects[0]?.id || "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load permission sets.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function updatePermissionSet(change: Partial<PermissionSet>) {
    if (!permissionSet) return;
    setPermissionSets((items) => items.map((item) => item.id === permissionSet.id ? { ...item, ...change } : item));
  }

  function setObjectGrant(key: keyof Omit<ObjectGrant, "objectId" | "object">, value: boolean) {
    if (!permissionSet || !selectedObject) return;
    const current = permissionSet.objectPermissions.find((grant) => grant.objectId === selectedObject.id);
    const next: ObjectGrant = {
      objectId: selectedObject.id,
      object: current?.object ?? { id: selectedObject.id, name: selectedObject.name, pluralLabel: selectedObject.pluralLabel, apiName: selectedObject.apiName },
      canCreate: current?.canCreate ?? false,
      canRead: current?.canRead ?? false,
      canEdit: current?.canEdit ?? false,
      canDelete: current?.canDelete ?? false,
      viewAll: current?.viewAll ?? false,
      modifyAll: current?.modifyAll ?? false,
      [key]: value,
    };
    updatePermissionSet({ objectPermissions: [...permissionSet.objectPermissions.filter((grant) => grant.objectId !== selectedObject.id), next] });
  }

  function setFieldGrant(fieldId: string, key: "canRead" | "canEdit", value: boolean) {
    if (!permissionSet || !selectedObject) return;
    const field = selectedObject.fields.find((item) => item.id === fieldId);
    if (!field) return;
    const current = permissionSet.fieldPermissions.find((grant) => grant.fieldId === fieldId);
    const canRead = key === "canRead" ? value : value || current?.canRead === true;
    const canEdit = key === "canEdit" ? value : value && (current?.canEdit ?? false);
    const next: FieldGrant = {
      fieldId,
      field: current?.field ?? { ...field, objectId: selectedObject.id },
      canRead,
      canEdit: canRead && canEdit,
    };
    updatePermissionSet({ fieldPermissions: [...permissionSet.fieldPermissions.filter((grant) => grant.fieldId !== fieldId), next] });
  }

  function setAppAccess(appId: string, canAccess: boolean) {
    if (!permissionSet) return;
    const app = apps.find((item) => item.id === appId);
    if (!app) return;
    const current = permissionSet.appPermissions.find((grant) => grant.appId === appId);
    const next = { appId, app: current?.app ?? { id: app.id, key: app.key, name: app.name }, canAccess };
    updatePermissionSet({ appPermissions: [...permissionSet.appPermissions.filter((grant) => grant.appId !== appId), next] });
  }

  function setTabAccess(appId: string, tabObjectId: string, visible: boolean) {
    if (!permissionSet) return;
    const app = apps.find((item) => item.id === appId);
    const object = app?.assignments.find((assignment) => assignment.objectId === tabObjectId)?.object;
    if (!app || !object) return;
    const current = permissionSet.tabPermissions.find((grant) => grant.appId === appId && grant.objectId === tabObjectId);
    const next: TabGrant = {
      appId,
      objectId: tabObjectId,
      visibility: visible ? "DEFAULT_ON" : "DEFAULT_OFF",
      app: current?.app ?? { id: app.id, name: app.name },
      object: current?.object ?? object,
    };
    updatePermissionSet({
      tabPermissions: [...permissionSet.tabPermissions.filter((grant) => grant.appId !== appId || grant.objectId !== tabObjectId), next],
    });
  }

  function setUserAssignment(user: User, assigned: boolean) {
    if (!permissionSet) return;
    const assignments = permissionSet.assignments.filter((item) => item.userId !== user.id);
    if (assigned) assignments.push({ userId: user.id, user });
    updatePermissionSet({ assignments });
  }

  async function save() {
    if (!permissionSet) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const objectPermissions = objects.map((object) => {
        const existing = permissionSet.objectPermissions.find((grant) => grant.objectId === object.id);
        return {
          objectId: object.id,
          canCreate: existing?.canCreate || false,
          canRead: existing?.canRead || false,
          canEdit: existing?.canEdit || false,
          canDelete: existing?.canDelete || false,
          viewAll: existing?.viewAll || false,
          modifyAll: existing?.modifyAll || false,
        };
      });
      const fieldPermissions = objects.flatMap((object) => object.fields.map((field) => {
        const existing = permissionSet.fieldPermissions.find((grant) => grant.fieldId === field.id);
        const canRead = existing?.canRead || existing?.canEdit || false;
        return { fieldId: field.id, canRead, canEdit: canRead && (field.dataType !== "AUTO_NUMBER" && (existing?.canEdit || false)) };
      }));
      const appPermissions = apps.map((app) => ({
        appId: app.id,
        canAccess: permissionSet.appPermissions.find((grant) => grant.appId === app.id)?.canAccess || false,
      }));
      const tabPermissions = apps.flatMap((app) => app.assignments.map(({ objectId: tabObjectId }) => ({
        appId: app.id,
        objectId: tabObjectId,
        visibility: permissionSet.tabPermissions.find((grant) => grant.appId === app.id && grant.objectId === tabObjectId)?.visibility || "DEFAULT_OFF",
      })));
      const saved = await requestJson<PermissionSet>("/api/crm-setup/permission-sets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissionSetId: permissionSet.id,
          name: permissionSet.name,
          description: permissionSet.description,
          userIds: permissionSet.assignments.map(({ userId }) => userId),
          objectPermissions,
          fieldPermissions,
          appPermissions,
          tabPermissions,
        }),
      });
      setPermissionSets((items) => items.map((item) => item.id === saved.id ? saved : item));
      setMessage(`${saved.name} permissions and assignments saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save permission set.");
    } finally {
      setSaving(false);
    }
  }

  async function createPermissionSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const created = await requestJson<PermissionSet>("/api/crm-setup/permission-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description") || null,
          ...(createMode === "clone" && permissionSet ? { cloneFromId: permissionSet.id } : {}),
        }),
      });
      setPermissionSets((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
      setPermissionSetId(created.id);
      setCreateMode(null);
      setMessage(`${created.name} created. Review and save its permissions before relying on its grants.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create permission set.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePermissionSet() {
    if (!permissionSet || permissionSet.assignments.length || !window.confirm(`Delete the ${permissionSet.name} permission set?`)) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/crm-setup/permission-sets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionSetId: permissionSet.id }),
      });
      setPermissionSets((items) => items.filter((item) => item.id !== permissionSet.id));
      setPermissionSetId("");
      setMessage(`${permissionSet.name} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete permission set.");
    } finally {
      setSaving(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((user) => !query || `${user.name} ${user.email} ${user.role} ${user.profile.name}`.toLowerCase().includes(query));
  }, [users, userSearch]);

  return <section className="crm-config-panel">
    <div className="crm-config-heading">
      <div><h2>Permission Sets</h2><p>Grant additional app, object, field, and tab access without removing Profile permissions.</p></div>
      <div className="crm-config-actions">
        <button className="button button-outline" disabled={!permissionSet || saving} onClick={() => setCreateMode("clone")}><Copy size={15} /> Clone</button>
        <button className="button button-primary" disabled={saving} onClick={() => setCreateMode("new")}><CirclePlus size={15} /> New permission set</button>
        <button className="button button-primary" disabled={!permissionSet || saving} onClick={() => void save()}><Save size={15} />{saving ? "Saving…" : "Save permission set"}</button>
      </div>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    {createMode && <form className="panel crm-config-toolbar" onSubmit={createPermissionSet}>
      <label className="field"><span>{createMode === "clone" ? "New cloned permission set name" : "Permission set name"}</span><input name="name" required maxLength={80} defaultValue={createMode === "clone" && permissionSet ? `${permissionSet.name} Copy` : ""} /></label>
      <label className="field"><span>Description</span><input name="description" maxLength={500} defaultValue={createMode === "clone" ? permissionSet?.description || "" : ""} /></label>
      <div className="crm-config-actions"><button type="button" className="button button-quiet" onClick={() => setCreateMode(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : createMode === "clone" ? "Clone permission set" : "Create permission set"}</button></div>
    </form>}
    {!permissionSets.length ? <p className="panel-empty-copy">No permission sets are configured yet.</p> : <>
      <div className="crm-config-toolbar">
        <label className="crm-config-object-picker"><span>Permission Set</span><select value={permissionSet?.id || ""} onChange={(event) => setPermissionSetId(event.target.value)}>{permissionSets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        {permissionSet && <span className="table-sub">{permissionSet.assignments.length} assigned user{permissionSet.assignments.length === 1 ? "" : "s"}</span>}
        {permissionSet && <button className="button button-outline" disabled={saving || permissionSet.assignments.length > 0} title={permissionSet.assignments.length ? "Remove all user assignments before deleting this permission set." : undefined} onClick={() => void deletePermissionSet()}><Trash2 size={14} /> Delete</button>}
      </div>
      {permissionSet && <>
        <label className="field crm-profile-description"><span>Name</span><input value={permissionSet.name} maxLength={80} onChange={(event) => updatePermissionSet({ name: event.target.value })} /></label>
        <label className="field crm-profile-description"><span>Description</span><input value={permissionSet.description || ""} maxLength={500} onChange={(event) => updatePermissionSet({ description: event.target.value || null })} /></label>
        {selectedObject && <div className="crm-config-toolbar">
          <label className="crm-config-object-picker"><span>Object</span><select value={selectedObject.id} onChange={(event) => setObjectId(event.target.value)}>{objects.map((object) => <option value={object.id} key={object.id}>{object.pluralLabel}</option>)}</select></label>
        </div>}
        {selectedObject && <div className="panel crm-permissions-panel">
          <div className="crm-panel-heading"><div><h3>{permissionSet.name} · {selectedObject.pluralLabel}</h3><p>These are additional grants. Profile access remains in effect, and inactive users still cannot sign in.</p></div></div>
          <div className="crm-permission-row"><strong>Object grants</strong>{([
            ["canCreate", "Create"], ["canRead", "Read"], ["canEdit", "Edit"], ["canDelete", "Delete"],
            ["viewAll", "View All"], ["modifyAll", "Modify All"],
          ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={permissionSet.objectPermissions.find((grant) => grant.objectId === selectedObject.id)?.[key] || false} onChange={(event) => setObjectGrant(key, event.target.checked)} />{label}</label>)}</div>
          {selectedObject.fields.map((field) => {
            const grant = permissionSet.fieldPermissions.find((item) => item.fieldId === field.id);
            return <div className="crm-permission-row" key={field.id}>
              <span><strong>{field.label}</strong><small>{field.apiName}{field.dataType === "AUTO_NUMBER" ? " · auto number" : ""}</small></span>
              <label><input type="checkbox" checked={grant?.canRead || grant?.canEdit || false} onChange={(event) => setFieldGrant(field.id, "canRead", event.target.checked)} />Read</label>
              <label><input type="checkbox" checked={field.dataType !== "AUTO_NUMBER" && grant?.canEdit || false} disabled={field.dataType === "AUTO_NUMBER" || !grant?.canRead} onChange={(event) => setFieldGrant(field.id, "canEdit", event.target.checked)} />Edit</label>
            </div>;
          })}
        </div>}
        <div className="panel crm-permissions-panel">
          <div className="crm-panel-heading"><div><h3>App and tab grants</h3><p>App and tab grants add navigation access; object grants still control direct API access.</p></div></div>
          {apps.map((app) => <section className="crm-profile-app" key={app.id}>
            <label><input type="checkbox" checked={permissionSet.appPermissions.find((grant) => grant.appId === app.id)?.canAccess || false} onChange={(event) => setAppAccess(app.id, event.target.checked)} /><strong>{app.name}</strong></label>
            {app.assignments.map(({ objectId: tabObjectId, object }) => {
              const grant = permissionSet.tabPermissions.find((item) => item.appId === app.id && item.objectId === tabObjectId);
              return <label className="crm-profile-tab" key={`${app.id}:${tabObjectId}`}><span>{object.pluralLabel}</span><input type="checkbox" checked={grant?.visibility === "DEFAULT_ON"} onChange={(event) => setTabAccess(app.id, tabObjectId, event.target.checked)} />Grant tab</label>;
            })}
          </section>)}
        </div>
        <div className="panel crm-permissions-panel">
          <div className="crm-panel-heading"><div><h3>User assignments</h3><p>Users can have multiple permission sets. Removing a set never removes Profile grants.</p></div></div>
          <label className="field crm-profile-description"><span>Search users</span><input type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Name, email, role, or profile" /></label>
          {filteredUsers.map((user) => {
            const assigned = assignedUserIds.has(user.id);
            return <div className="crm-permission-row" key={user.id}>
              <span><strong>{user.name}{!user.active ? " · inactive" : ""}</strong><small>{user.email} · {user.role} · {user.profile.name}</small></span>
              <label><input type="checkbox" checked={assigned} disabled={!user.active && !assigned} onChange={(event) => setUserAssignment(user, event.target.checked)} />Assigned</label>
            </div>;
          })}
        </div>
      </>}
    </>}
  </section>;
}
