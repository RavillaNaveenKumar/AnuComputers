"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CirclePlus, Save, Trash2 } from "lucide-react";

export type RegistryObject = {
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
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${response.status}).`);
  }
  return await response.json() as T;
}

function useError() {
  const [error, setError] = useState("");
  return { error, setError };
}

type AppAssignment = { objectId: string; navigationOrder: number; label: string | null; icon: string | null; defaultListView: string | null; object: RegistryObject };
type CrmApp = { id: string; key: string; name: string; icon: string; active: boolean; isDefault: boolean; defaultObjectId: string | null; assignments: AppAssignment[] };

export function AppManager({ objects }: { objects: RegistryObject[] }) {
  const router = useRouter();
  const [apps, setApps] = useState<CrmApp[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newApp, setNewApp] = useState(false);
  const [saving, setSaving] = useState(false);
  const { error, setError } = useError();
  const selected = apps.find((app) => app.id === selectedId) || apps[0] || null;

  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ apps: CrmApp[] }>("/api/crm-setup/apps");
      setApps(result.apps);
      setSelectedId((id) => result.apps.some((app) => app.id === id) ? id : result.apps[0]?.id || "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load applications."); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  function updateSelected(change: Partial<CrmApp>) {
    if (selected) setApps((items) => items.map((item) => item.id === selected.id ? { ...item, ...change } : item));
  }
  function addObject(objectId: string) {
    if (!selected || !objectId || selected.assignments.some((item) => item.objectId === objectId)) return;
    const object = objects.find((item) => item.id === objectId);
    if (!object) return;
    updateSelected({ assignments: [...selected.assignments, { objectId, navigationOrder: selected.assignments.length, label: null, icon: null, defaultListView: null, object }] });
  }
  function move(index: number, offset: -1 | 1) {
    if (!selected) return;
    const target = index + offset;
    if (target < 0 || target >= selected.assignments.length) return;
    const assignments = [...selected.assignments];
    [assignments[index], assignments[target]] = [assignments[target], assignments[index]];
    updateSelected({ assignments: assignments.map((item, navigationOrder) => ({ ...item, navigationOrder })) });
  }
  async function save() {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      await requestJson(`/api/crm-setup/apps/${selected.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected.name, icon: selected.icon, active: selected.active, isDefault: selected.isDefault, defaultObjectId: selected.defaultObjectId,
          assignments: selected.assignments.map((item) => ({
            objectId: item.objectId, navigationOrder: item.navigationOrder, label: item.label,
            icon: item.icon, defaultListView: item.defaultListView,
          })),
        }),
      });
      await load();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save application navigation.");
    } finally { setSaving(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true); setError("");
    try {
      const created = await requestJson<CrmApp>("/api/crm-setup/apps", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: form.get("key"), name: form.get("name"), icon: form.get("icon") || "Boxes", defaultObjectId: null, isDefault: form.get("isDefault") === "on" }),
      });
      await load(); setSelectedId(created.id); setNewApp(false); router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create application.");
    } finally { setSaving(false); }
  }
  const available = useMemo(() => objects.filter((object) => object.active && object.objectType !== "SYSTEM" && !selected?.assignments.some((item) => item.objectId === object.id)), [objects, selected]);
  return <section className="crm-config-panel">
    <div className="crm-config-heading"><div><h2>App Manager</h2><p>Create CRM apps and assign standard and custom objects. Grant app access in Profiles.</p></div><div className="crm-config-actions"><button className="button button-secondary" onClick={() => setNewApp((value) => !value)}>New application</button><button className="button button-primary" onClick={() => void save()} disabled={!selected || saving}><Save size={15} />{saving ? "Saving…" : "Save application"}</button></div></div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {newApp && <form className="panel crm-inline-config-form" onSubmit={create}><label className="field"><span>Application key</span><input name="key" required maxLength={80} placeholder="GemNava CRM" /><small>Spaces and uppercase letters are converted to a lowercase URL key, such as gemnava-crm.</small></label><label className="field"><span>Application name</span><input name="name" required maxLength={80} placeholder="GemNava CRM" /></label><label className="field"><span>Icon</span><input name="icon" defaultValue="Boxes" maxLength={40} /></label><label className="crm-config-toggle"><input type="checkbox" name="isDefault" /><span>Make this the default app</span></label><button className="button button-primary" disabled={saving}>Create application</button></form>}
    <div className="crm-app-tabs" role="tablist">{apps.map((app) => <button key={app.id} role="tab" aria-selected={app.id === selected?.id} className={app.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(app.id)}>{app.name}</button>)}</div>
    {selected && <div className="panel crm-app-editor">
      <div className="form-grid crm-config-app-settings">
        <label className="field"><span>Application name</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
        <label className="field"><span>Icon name</span><input value={selected.icon} onChange={(event) => updateSelected({ icon: event.target.value })} /></label>
        <label className="field"><span>Default landing page</span><select value={selected.defaultObjectId || ""} onChange={(event) => updateSelected({ defaultObjectId: event.target.value || null })}><option value="">Dashboard</option>{selected.assignments.map((item) => <option value={item.objectId} key={item.objectId}>{item.object.pluralLabel}</option>)}</select></label>
        <label className="crm-config-toggle"><input type="checkbox" checked={selected.active} onChange={(event) => updateSelected({ active: event.target.checked })} /><span>Application is active and shown in the workspace selector</span></label>
        <label className="crm-config-toggle"><input type="checkbox" checked={selected.isDefault} onChange={(event) => updateSelected({ isDefault: event.target.checked })} /><span>Default application for users who can access it</span></label>
      </div>
      <div className="crm-panel-heading"><div><h3>Navigation objects</h3><p>Order and label objects in this application without duplicating their metadata or records.</p></div><select aria-label="Add object to application" defaultValue="" onChange={(event) => { addObject(event.target.value); event.target.value = ""; }}><option value="" disabled>Add an object…</option>{available.map((object) => <option key={object.id} value={object.id}>{object.pluralLabel}</option>)}</select></div>
      {selected.assignments.map((assignment, index) => <div className="crm-config-row" key={assignment.objectId}>
        <div className="crm-config-order"><button aria-label={`Move ${assignment.object.pluralLabel} up`} className="icon-button" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button aria-label={`Move ${assignment.object.pluralLabel} down`} className="icon-button" disabled={index === selected.assignments.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button></div>
        <span><strong>{assignment.label || assignment.object.pluralLabel}</strong><small>{assignment.object.apiName}</small></span>
        <input aria-label={`${assignment.object.pluralLabel} application label`} value={assignment.label || ""} placeholder={assignment.object.pluralLabel} onChange={(event) => updateSelected({ assignments: selected.assignments.map((item) => item.objectId === assignment.objectId ? { ...item, label: event.target.value || null } : item) })} />
        <input aria-label={`${assignment.object.pluralLabel} icon`} value={assignment.icon || ""} placeholder="Icon" onChange={(event) => updateSelected({ assignments: selected.assignments.map((item) => item.objectId === assignment.objectId ? { ...item, icon: event.target.value || null } : item) })} />
        <input aria-label={`${assignment.object.pluralLabel} default list view`} value={assignment.defaultListView || ""} placeholder="List view" onChange={(event) => updateSelected({ assignments: selected.assignments.map((item) => item.objectId === assignment.objectId ? { ...item, defaultListView: event.target.value || null } : item) })} />
        <button aria-label={`Remove ${assignment.object.pluralLabel} from application`} className="icon-button crm-danger-action" onClick={() => updateSelected({ assignments: selected.assignments.filter((item) => item.objectId !== assignment.objectId).map((item, navigationOrder) => ({ ...item, navigationOrder })), defaultObjectId: selected.defaultObjectId === assignment.objectId ? null : selected.defaultObjectId })}><Trash2 size={15} /></button>
      </div>)}
    </div>}
  </section>;
}

type Relationship = {
  id: string; label: string; relationshipType: "LOOKUP" | "ONE_TO_MANY" | "MANY_TO_MANY";
  sourceObject: { id: string; pluralLabel: string }; targetObject: { id: string; pluralLabel: string };
  junctionObject: { id: string; pluralLabel: string } | null;
};

export function RelationshipManager({ objects }: { objects: RegistryObject[] }) {
  const [items, setItems] = useState<Relationship[]>([]);
  const [saving, setSaving] = useState(false);
  const { error, setError } = useError();
  const load = useCallback(async () => {
    try { setItems(await requestJson<Relationship[]>("/api/crm-setup/relationships")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load relationships."); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true); setError("");
    try {
      await requestJson("/api/crm-setup/relationships", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceObjectId: form.get("sourceObjectId"), targetObjectId: form.get("targetObjectId"),
          label: form.get("label"), relationshipType: form.get("relationshipType"),
          ...(form.get("relationshipType") === "MANY_TO_MANY" ? { junctionObjectId: form.get("junctionObjectId") } : {}),
        }),
      });
      formElement.reset();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create relationship."); }
    finally { setSaving(false); }
  }
  return <section className="crm-config-panel"><div className="crm-config-heading"><div><h2>Relationship Manager</h2><p>Define lookup, one-to-many, and many-to-many links using the shared object registry.</p></div></div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    <form className="panel crm-inline-config-form" onSubmit={create}>
      <label className="field"><span>Source object</span><select name="sourceObjectId" required>{objects.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.pluralLabel}</option>)}</select></label>
      <label className="field"><span>Relationship label</span><input name="label" required maxLength={100} /></label>
      <label className="field"><span>Target object</span><select name="targetObjectId" required>{objects.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.pluralLabel}</option>)}</select></label>
      <label className="field"><span>Type</span><select name="relationshipType"><option value="ONE_TO_MANY">One-to-many</option><option value="LOOKUP">Lookup</option><option value="MANY_TO_MANY">Many-to-many</option></select></label>
      <label className="field"><span>Junction object (many-to-many)</span><select name="junctionObjectId" defaultValue=""><option value="">Select…</option>{objects.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.pluralLabel}</option>)}</select></label>
      <button className="button button-primary" disabled={saving}><CirclePlus size={14} />{saving ? "Creating…" : "Create relationship"}</button>
    </form>
    <div className="panel crm-config-table">{items.map((item) => <div className="crm-config-row" key={item.id}><span><strong>{item.sourceObject.pluralLabel}</strong><small>{item.label} · {item.relationshipType.replaceAll("_", " ")}</small></span><span className="crm-relationship-arrow">→</span><span><strong>{item.targetObject.pluralLabel}</strong><small>{item.junctionObject ? `Junction: ${item.junctionObject.pluralLabel}` : "Related object"}</small></span></div>)}
      {!items.length && <p className="panel-empty-copy">No relationships are configured yet.</p>}</div>
  </section>;
}

type LayoutData = {
  id: string; name: string; fieldOrder: string[]; hiddenFieldIds: string[];
  sections: { id: string; label: string; fieldIds: string[] }[];
  relatedLists: string[]; detailTabs: { id: string; label: string }[];
  object: { fields: RegistryObject["fields"]; outgoingRelationships: { id: string; label: string }[] };
};

export function PageLayoutManager({ objects }: { objects: RegistryObject[] }) {
  const [objectId, setObjectId] = useState("");
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [saving, setSaving] = useState(false);
  const { error, setError } = useError();
  useEffect(() => { if (!objectId && objects.length) setObjectId(objects[0].id); }, [objects, objectId]);
  useEffect(() => {
    if (!objectId) return;
    let active = true;
    requestJson<LayoutData>(`/api/crm-setup/layouts/${objectId}`)
      .then((result) => { if (active) { setLayout(result); setError(""); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load record layout."); });
    return () => { active = false; };
  }, [objectId, setError]);
  function update(change: Partial<LayoutData>) { setLayout((current) => current ? { ...current, ...change } : current); }
  function toggleField(fieldId: string) {
    if (!layout) return;
    const visible = layout.fieldOrder.includes(fieldId);
    if (visible) {
      const field = layout.object.fields.find((item) => item.id === fieldId);
      if (field?.required || field?.protected) return;
      update({
        fieldOrder: layout.fieldOrder.filter((id) => id !== fieldId),
        hiddenFieldIds: [...layout.hiddenFieldIds, fieldId],
        sections: layout.sections.map((section) => ({ ...section, fieldIds: section.fieldIds.filter((id) => id !== fieldId) })),
      });
    } else update({
      fieldOrder: [...layout.fieldOrder, fieldId],
      hiddenFieldIds: layout.hiddenFieldIds.filter((id) => id !== fieldId),
      sections: layout.sections.length
        ? [{ ...layout.sections[0], fieldIds: [...layout.sections[0].fieldIds, fieldId] }, ...layout.sections.slice(1)]
        : layout.sections,
    });
  }
  function move(index: number, offset: -1 | 1) {
    if (!layout) return;
    const target = index + offset;
    if (target < 0 || target >= layout.fieldOrder.length) return;
    const fieldOrder = [...layout.fieldOrder];
    [fieldOrder[index], fieldOrder[target]] = [fieldOrder[target], fieldOrder[index]];
    update({ fieldOrder });
  }
  async function save() {
    if (!layout || !objectId) return;
    setSaving(true); setError("");
    try {
      const saved = await requestJson<LayoutData>(`/api/crm-setup/layouts/${objectId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: layout.name,
          fieldOrder: layout.fieldOrder,
          hiddenFieldIds: layout.hiddenFieldIds,
          sections: layout.sections,
          relatedLists: layout.relatedLists,
          detailTabs: layout.detailTabs,
        }),
      });
      setLayout((current) => current ? { ...current, ...saved } : saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save record layout."); }
    finally { setSaving(false); }
  }
  return <section className="crm-config-panel"><div className="crm-config-heading"><div><h2>Page Layouts</h2><p>Configure field visibility and ordering, sections, related lists, and record tabs.</p></div><button className="button button-primary" onClick={() => void save()} disabled={!layout || saving}><Save size={15} />{saving ? "Saving…" : "Save layout"}</button></div>
    <label className="crm-config-object-picker"><span>Object</span><select value={objectId} onChange={(event) => setObjectId(event.target.value)}>{objects.map((item) => <option value={item.id} key={item.id}>{item.pluralLabel}</option>)}</select></label>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    {layout && <div className="crm-layout-grid">
      <section className="panel crm-layout-fields"><div className="crm-panel-heading"><div><h3>Field order</h3><p>Required and protected fields cannot be hidden.</p></div></div>
        {layout.object.fields.map((field) => {
          const index = layout.fieldOrder.indexOf(field.id);
          const visible = index >= 0;
          return <div className={`crm-layout-field ${visible ? "" : "hidden"}`} key={field.id}><span className="crm-field-main"><strong>{field.label}</strong><small>{field.apiName}</small></span>
            <button className="icon-button" aria-label={`Move ${field.label} up`} disabled={!visible || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
            <button className="icon-button" aria-label={`Move ${field.label} down`} disabled={!visible || index === layout.fieldOrder.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
            <button className="button button-quiet" disabled={(field.required || field.protected) && visible} onClick={() => toggleField(field.id)}>{visible ? "Hide" : "Show"}</button>
          </div>;
        })}
      </section>
      <section className="panel crm-layout-fields"><div className="crm-panel-heading"><div><h3>Layout sections & related lists</h3><p>Changes persist in the database with this object layout.</p></div></div>
        <label className="field crm-layout-name"><span>Layout name</span><input value={layout.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label className="field crm-layout-name"><span>First section label</span><input value={layout.sections[0]?.label || ""} onChange={(event) => update({ sections: [{ id: layout.sections[0]?.id || "main", label: event.target.value, fieldIds: layout.fieldOrder }, ...layout.sections.slice(1)] })} /></label>
        <div className="crm-layout-related-list"><strong>Related lists</strong>{layout.object.outgoingRelationships.map((relation) => <label key={relation.id}><input type="checkbox" checked={layout.relatedLists.includes(relation.id)} onChange={(event) => update({ relatedLists: event.target.checked ? [...layout.relatedLists, relation.id] : layout.relatedLists.filter((id) => id !== relation.id) })} />{relation.label}</label>)}</div>
        <label className="field crm-layout-name"><span>Detail tabs (comma-separated labels)</span><input value={layout.detailTabs.map((tab) => tab.label).join(", ")} onChange={(event) => update({ detailTabs: event.target.value.split(",").map((label, index) => ({ id: `tab-${index + 1}`, label: label.trim() })).filter((tab) => tab.label) })} /></label>
      </section>
    </div>}
  </section>;
}

