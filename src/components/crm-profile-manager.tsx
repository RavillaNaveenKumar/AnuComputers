"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, CirclePlus, Save, ShieldCheck, Trash2 } from "lucide-react";

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
  visible: boolean;
  editable: boolean;
  field: { id: string; objectId: string; label: string; apiName: string; dataType: string };
};
type AppGrant = { appId: string; canAccess: boolean; app: { id: string; key: string; name: string } };
type TabGrant = {
  appId: string;
  objectId: string;
  visibility: "DEFAULT_ON" | "DEFAULT_OFF" | "HIDDEN";
  app: { id: string; name: string };
  object: { id: string; name: string; pluralLabel: string };
};
type Profile = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  allowLogin: boolean;
  objectPermissions: ObjectGrant[];
  fieldPermissions: FieldGrant[];
  appPermissions: AppGrant[];
  tabPermissions: TabGrant[];
  userAssignments: { id: string; name: string; email: string; role: string }[];
};
type App = {
  id: string;
  key: string;
  name: string;
  assignments: { objectId: string; object: { id: string; name: string; pluralLabel: string } }[];
};
type RegistryObject = {
  id: string;
  name: string;
  pluralLabel: string;
  apiName: string;
  objectType: "STANDARD" | "CUSTOM" | "SYSTEM";
  module: "SALES" | "SERVICE" | "COMMON";
  icon: string;
  active: boolean;
  fields: { id: string; label: string; apiName: string; dataType: string; required: boolean; protected: boolean }[];
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : `Request failed (${response.status}).`;
    throw new Error(error);
  }
  return body as T;
}

export function CrmProfileManager() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [objects, setObjects] = useState<RegistryObject[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [profileId, setProfileId] = useState("");
  const [objectId, setObjectId] = useState("");
  const [createMode, setCreateMode] = useState<"new" | "clone" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const profile = profiles.find((item) => item.id === profileId) || profiles[0] || null;
  const selectedObject = objects.find((object) => object.id === objectId) || objects[0] || null;
  const isSystemAdministrator = profile?.key === "system-administrator";

  const load = useCallback(async () => {
    try {
      const objectList = await requestJson<RegistryObject[]>("/api/crm-setup/objects");
      const result = await requestJson<{ profiles: Profile[]; apps: App[] }>("/api/crm-setup/profiles");
      setProfiles(result.profiles);
      setApps(result.apps);
      setObjects(objectList);
      setProfileId((current) => result.profiles.some((item) => item.id === current) ? current : result.profiles[0]?.id || "");
      setObjectId((current) => objectList.some((object) => object.id === current) ? current : objectList[0]?.id || "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load profiles.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const currentObjectGrant = useMemo(
    () => profile?.objectPermissions.find((grant) => grant.objectId === selectedObject?.id) || null,
    [profile, selectedObject],
  );
  const currentFields = useMemo(
    () => selectedObject?.fields.map((field) => ({
      ...field,
      grant: profile?.fieldPermissions.find((permission) => permission.fieldId === field.id) || null,
    })) || [],
    [profile, selectedObject],
  );

  function updateProfile(change: Partial<Profile>) {
    if (!profile) return;
    setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, ...change } : item));
  }

  function setObjectGrant(key: keyof Omit<ObjectGrant, "objectId" | "object">, value: boolean) {
    if (!profile || !selectedObject || isSystemAdministrator) return;
    const current = profile.objectPermissions.find((permission) => permission.objectId === selectedObject.id);
    const next: ObjectGrant = {
      objectId: selectedObject.id,
      object: { id: selectedObject.id, name: selectedObject.name, pluralLabel: selectedObject.pluralLabel, apiName: selectedObject.apiName },
      canCreate: current?.canCreate ?? false,
      canRead: current?.canRead ?? false,
      canEdit: current?.canEdit ?? false,
      canDelete: current?.canDelete ?? false,
      viewAll: current?.viewAll ?? false,
      modifyAll: current?.modifyAll ?? false,
      [key]: value,
    };
    updateProfile({ objectPermissions: [...profile.objectPermissions.filter((item) => item.objectId !== selectedObject.id), next] });
  }

  function setFieldGrant(fieldId: string, key: "visible" | "editable", value: boolean) {
    if (!profile || isSystemAdministrator) return;
    const current = profile.fieldPermissions.find((permission) => permission.fieldId === fieldId);
    const next = {
      fieldId,
      field: current?.field ?? { id: fieldId, objectId: selectedObject?.id || "", label: "", apiName: "", dataType: "" },
      visible: current?.visible ?? false,
      editable: current?.editable ?? false,
      [key]: value,
    };
    if (key === "visible" && !value) next.editable = false;
    updateProfile({ fieldPermissions: [...profile.fieldPermissions.filter((item) => item.fieldId !== fieldId), next] });
  }

  function setAppAccess(appId: string, canAccess: boolean) {
    if (!profile || isSystemAdministrator) return;
    const current = profile.appPermissions.find((permission) => permission.appId === appId);
    const app = apps.find((item) => item.id === appId);
    if (!app) return;
    const next = { appId, app: current?.app ?? { id: app.id, key: app.key, name: app.name }, canAccess };
    updateProfile({ appPermissions: [...profile.appPermissions.filter((item) => item.appId !== appId), next] });
  }

  function setTabVisibility(appId: string, tabObjectId: string, visibility: TabGrant["visibility"]) {
    if (!profile || isSystemAdministrator) return;
    const current = profile.tabPermissions.find((permission) => permission.appId === appId && permission.objectId === tabObjectId);
    const app = apps.find((item) => item.id === appId);
    const object = app?.assignments.find((assignment) => assignment.objectId === tabObjectId)?.object;
    if (!app || !object) return;
    const next: TabGrant = {
      appId,
      objectId: tabObjectId,
      visibility,
      app: current?.app ?? { id: app.id, name: app.name },
      object: current?.object ?? object,
    };
    updateProfile({ tabPermissions: [...profile.tabPermissions.filter((item) => item.appId !== appId || item.objectId !== tabObjectId), next] });
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const objectPermissions = objects.map((object) => {
        const existing = profile.objectPermissions.find((permission) => permission.objectId === object.id);
        const fullGrant = isSystemAdministrator;
        return {
          objectId: object.id,
          canCreate: fullGrant || existing?.canCreate || false,
          canRead: fullGrant || existing?.canRead || false,
          canEdit: fullGrant || existing?.canEdit || false,
          canDelete: fullGrant || existing?.canDelete || false,
          viewAll: fullGrant || existing?.viewAll || false,
          modifyAll: fullGrant || existing?.modifyAll || false,
        };
      });
      const fieldPermissions = objects.flatMap((object) => object.fields.map((field) => {
        const existing = profile.fieldPermissions.find((permission) => permission.fieldId === field.id);
        const visible = isSystemAdministrator || existing?.visible || false;
        const editable = field.dataType !== "AUTO_NUMBER" && (isSystemAdministrator || existing?.editable || false);
        return { fieldId: field.id, visible, editable: visible && editable };
      }));
      const appPermissions = apps.map((app) => ({
        appId: app.id,
        canAccess: isSystemAdministrator || profile.appPermissions.find((permission) => permission.appId === app.id)?.canAccess || false,
      }));
      const tabPermissions = apps.flatMap((app) => app.assignments.map(({ objectId: tabObjectId }) => ({
        appId: app.id,
        objectId: tabObjectId,
        visibility: isSystemAdministrator
          ? "DEFAULT_ON" as const
          : profile.tabPermissions.find((permission) => permission.appId === app.id && permission.objectId === tabObjectId)?.visibility || "HIDDEN" as const,
      })));
      const saved = await requestJson<Profile>("/api/crm-setup/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          name: profile.name,
          description: profile.description,
          allowLogin: isSystemAdministrator || profile.allowLogin,
          objectPermissions,
          fieldPermissions,
          appPermissions,
          tabPermissions,
        }),
      });
      setProfiles((items) => items.map((item) => item.id === saved.id ? saved : item));
      setMessage(`${saved.name} permissions saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save profile permissions.");
    } finally {
      setSaving(false);
    }
  }

  async function createProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const created = await requestJson<Profile>("/api/crm-setup/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description") || null,
          ...(createMode === "clone" && profile ? { cloneFromId: profile.id } : {}),
        }),
      });
      setProfiles((items) => [...items, created].sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name)));
      setProfileId(created.id);
      setCreateMode(null);
      setMessage(`${created.name} created. Review and save its permissions before assigning users.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create profile.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProfile() {
    if (!profile || profile.builtIn || !window.confirm(`Delete the ${profile.name} profile?`)) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/crm-setup/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      setProfiles((items) => items.filter((item) => item.id !== profile.id));
      setProfileId("");
      setMessage(`${profile.name} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete profile.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="crm-config-panel">
    <div className="crm-config-heading">
      <div><h2>Profiles</h2><p>Set a user’s baseline app, object CRUD, field-level, tab, and login permissions.</p></div>
      <div className="crm-config-actions">
        <button className="button button-outline" disabled={!profile || saving} onClick={() => setCreateMode("clone")}><Copy size={15} /> Clone</button>
        <button className="button button-primary" disabled={saving} onClick={() => setCreateMode("new")}><CirclePlus size={15} /> New profile</button>
        <button className="button button-primary" disabled={!profile || saving} onClick={() => void save()}><Save size={15} />{saving ? "Saving…" : "Save profile"}</button>
      </div>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    {createMode && <form className="panel crm-config-toolbar" onSubmit={createProfile}>
      <label className="field"><span>{createMode === "clone" ? "New cloned profile name" : "Profile name"}</span><input name="name" required maxLength={80} defaultValue={createMode === "clone" && profile ? `${profile.name} Copy` : ""} /></label>
      <label className="field"><span>Description</span><input name="description" maxLength={500} defaultValue={createMode === "clone" ? profile?.description || "" : ""} /></label>
      <div className="crm-config-actions"><button type="button" className="button button-quiet" onClick={() => setCreateMode(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : createMode === "clone" ? "Clone profile" : "Create profile"}</button></div>
    </form>}
    {!profiles.length ? <p className="panel-empty-copy">No profiles are configured. Apply the profile security database migration.</p> : <>
      <div className="crm-config-toolbar">
        <label className="crm-config-object-picker"><span>Profile</span><select value={profile?.id || ""} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option value={item.id} key={item.id}>{item.name}{item.builtIn ? " · built-in" : ""}</option>)}</select></label>
        <label className="crm-required-toggle"><input type="checkbox" checked={profile?.allowLogin || false} disabled={!profile || isSystemAdministrator} onChange={(event) => updateProfile({ allowLogin: event.target.checked })} /><span>Allow login for assigned users</span></label>
        {profile && <span className="table-sub">{profile.userAssignments.length} assigned user{profile.userAssignments.length === 1 ? "" : "s"}</span>}
        {profile && !profile.builtIn && <button className="button button-outline" disabled={saving || profile.userAssignments.length > 0} title={profile.userAssignments.length ? "Reassign users before deleting this profile." : undefined} onClick={() => void deleteProfile()}><Trash2 size={14} /> Delete</button>}
      </div>
      {profile && <label className="field crm-profile-description"><span>Description</span><input value={profile.description || ""} maxLength={500} onChange={(event) => updateProfile({ description: event.target.value })} /></label>}
      {isSystemAdministrator && <p className="crm-dialog-note"><ShieldCheck size={14} /> System Administrator keeps full object and application access; auto-number fields remain read-only.</p>}
      {selectedObject && profile && <div className="crm-config-toolbar">
        <label className="crm-config-object-picker"><span>Object</span><select value={selectedObject.id} onChange={(event) => setObjectId(event.target.value)}>{objects.map((object) => <option value={object.id} key={object.id}>{object.pluralLabel}</option>)}</select></label>
      </div>}
      {selectedObject && profile && <div className="panel crm-permissions-panel">
        <div className="crm-panel-heading"><div><h3>{profile.name} · {selectedObject.pluralLabel}</h3><p>Permissions apply to every app exposing this object. Field visibility and editability are enforced by CRM record APIs.</p></div></div>
        <div className="crm-permission-row"><strong>Object access</strong>{([
          ["canCreate", "Create"], ["canRead", "Read"], ["canEdit", "Edit"], ["canDelete", "Delete"],
          ["viewAll", "View All"], ["modifyAll", "Modify All"],
        ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={isSystemAdministrator || currentObjectGrant?.[key] || false} disabled={isSystemAdministrator} onChange={(event) => setObjectGrant(key, event.target.checked)} />{label}</label>)}</div>
        {currentFields.map(({ id, label, apiName, protected: isProtected, dataType, grant }) => {
          const visible = isSystemAdministrator || grant?.visible || false;
          const editable = dataType !== "AUTO_NUMBER" && (isSystemAdministrator || grant?.editable || false);
          return <div className="crm-permission-row" key={id}>
            <span><strong>{label}</strong><small>{apiName}{isProtected ? " · protected" : ""}{dataType === "AUTO_NUMBER" ? " · auto number" : ""}</small></span>
            <label><input type="checkbox" checked={visible} disabled={isSystemAdministrator} onChange={(event) => setFieldGrant(id, "visible", event.target.checked)} />Visible</label>
            <label><input type="checkbox" checked={editable} disabled={isSystemAdministrator || dataType === "AUTO_NUMBER" || !visible} onChange={(event) => setFieldGrant(id, "editable", event.target.checked)} />Editable</label>
          </div>;
        })}
      </div>}
      {profile && <div className="panel crm-permissions-panel">
        <div className="crm-panel-heading"><div><h3>Application access</h3><p>App access and tab visibility control navigation; object grants still control direct API access.</p></div></div>
        {apps.map((app) => <section className="crm-profile-app" key={app.id}>
          <label><input type="checkbox" checked={isSystemAdministrator || profile.appPermissions.find((permission) => permission.appId === app.id)?.canAccess || false} disabled={isSystemAdministrator} onChange={(event) => setAppAccess(app.id, event.target.checked)} /><strong>{app.name}</strong></label>
          {app.assignments.map(({ objectId: tabObjectId, object }) => {
            const grant = profile.tabPermissions.find((permission) => permission.appId === app.id && permission.objectId === tabObjectId);
            return <label className="crm-profile-tab" key={`${app.id}:${tabObjectId}`}><span>{object.pluralLabel}</span><select value={isSystemAdministrator ? "DEFAULT_ON" : grant?.visibility || "HIDDEN"} disabled={isSystemAdministrator} onChange={(event) => setTabVisibility(app.id, tabObjectId, event.target.value as TabGrant["visibility"])}><option value="DEFAULT_ON">Default On</option><option value="DEFAULT_OFF">Default Off</option><option value="HIDDEN">Hidden</option></select></label>;
          })}
        </section>)}
      </div>}
    </>}
  </section>;
}
