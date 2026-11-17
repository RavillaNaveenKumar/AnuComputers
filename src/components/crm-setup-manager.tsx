"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CirclePlus, Database, ExternalLink, Eye, EyeOff, ListPlus, Search, Trash2, X } from "lucide-react";
import { AppManager, PageLayoutManager, RelationshipManager } from "@/components/crm-setup-managers";
import { CrmCustomRecords } from "@/components/crm-custom-records";
import { CrmUserManager, SmtpConnectionTest } from "@/components/crm-user-manager";
import { CrmProfileManager } from "@/components/crm-profile-manager";
import { CrmPermissionSetManager } from "@/components/crm-permission-set-manager";
import { CrmRoleHierarchyManager } from "@/components/crm-role-hierarchy-manager";
import { CrmSharingManager } from "@/components/crm-sharing-manager";
import { CrmSecurityInsightsManager } from "@/components/crm-security-insights-manager";

type CrmFieldRow = {
  id: string;
  label: string;
  apiName: string;
  dataType: string;
  required: boolean;
  unique: boolean;
  protected: boolean;
  origin: "SYSTEM" | "STANDARD" | "CUSTOM";
  readOnly: boolean;
  isNameField: boolean;
  fieldLength: number | null;
  decimalPlaces: number | null;
  externalId: boolean;
  lookupTargetApiName: string | null;
  autoNumberPrefix: string | null;
  autoNumberSuffix: string | null;
  autoNumberStart: number | null;
  autoNumberDigits: number | null;
  active: boolean;
  picklistValues: { value: string; label: string }[];
  defaultValue: string | null;
  description: string | null;
  helpText: string | null;
};

type CrmObjectRow = {
  id: string;
  name: string;
  pluralLabel: string;
  apiName: string;
  displayFieldApiName: string | null;
  description: string | null;
  objectType: "STANDARD" | "CUSTOM" | "SYSTEM";
  module: "SALES" | "SERVICE" | "COMMON";
  icon: string;
  active: boolean;
  protected: boolean;
  recordCount: number;
  fields: CrmFieldRow[];
  outgoingRelationships: { id: string; label: string; relationshipType: string; targetObject: { name: string; pluralLabel: string } }[];
};

const fieldTypes = [
  ["TEXT", "Text"], ["TEXT_AREA", "Text Area"], ["LONG_TEXT_AREA", "Long Text Area"], ["NUMBER", "Number"], ["CURRENCY", "Currency"], ["PERCENT", "Percent"],
  ["DATE", "Date"], ["DATETIME", "DateTime"], ["EMAIL", "Email"], ["PHONE", "Phone"],
  ["URL", "URL"], ["CHECKBOX", "Checkbox"], ["PICKLIST", "Picklist"],
  ["MULTI_SELECT_PICKLIST", "Multi-Select Picklist"], ["LOOKUP", "Lookup"], ["AUTO_NUMBER", "Auto Number"],
] as const;
async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = body.error;
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null && "formErrors" in error) {
      const messages = (error as { formErrors?: unknown; fieldErrors?: Record<string, unknown> });
      const firstFieldError = Object.values(messages.fieldErrors || {}).flat().find((item) => typeof item === "string");
      if (typeof firstFieldError === "string") return firstFieldError;
      if (Array.isArray(messages.formErrors) && typeof messages.formErrors[0] === "string") return messages.formErrors[0];
    }
  }
  return `Request failed (${response.status}).`;
}

export function CrmSetupManager() {
  const [section, setSection] = useState<"objects" | "relationships" | "apps" | "layouts" | "profiles" | "permission-sets" | "role-hierarchy" | "users" | "security" | "sharing" | "login-history" | "audit-logs" | "effective-permissions">("objects");
  const [objects, setObjects] = useState<CrmObjectRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const [objectType, setObjectType] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [objectDialog, setObjectDialog] = useState(false);
  const [fieldDialog, setFieldDialog] = useState(false);
  const [fieldFilter, setFieldFilter] = useState<"ALL" | "STANDARD" | "CUSTOM" | "READ_ONLY" | "EDITABLE">("ALL");
  const [nameFieldType, setNameFieldType] = useState<"TEXT" | "AUTO_NUMBER">("TEXT");
  const [fieldTypeForDialog, setFieldTypeForDialog] = useState("TEXT");
  const [autoNumberPreview, setAutoNumberPreview] = useState({ prefix: "", suffix: "", start: "1", digits: "4" });
  const [editingObject, setEditingObject] = useState<CrmObjectRow | null>(null);
  const [editingField, setEditingField] = useState<CrmFieldRow | null>(null);
  const selected = objects.find((object) => object.id === selectedId) || null;

  const loadObjects = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams();
    if (search.trim()) query.set("q", search.trim());
    if (module) query.set("module", module);
    if (objectType) query.set("type", objectType);
    try {
      const response = await fetch(`/api/crm-setup/objects?${query.toString()}`);
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as CrmObjectRow[];
      setObjects(result);
      setSelectedId((current) => result.some((object) => object.id === current) ? current : result[0]?.id || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load CRM objects.");
    } finally {
      setLoading(false);
    }
  }, [search, module, objectType]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadObjects(); }, search ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [loadObjects, search]);

  async function send(url: string, method: string, body?: unknown) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(await responseError(response));
      return await response.json() as unknown;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The request could not be completed.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveObject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name"),
      pluralLabel: form.get("pluralLabel"),
      description: form.get("description") || null,
      module: form.get("module"),
      icon: form.get("icon") || "Database",
      ...(!editingObject ? { apiName: form.get("apiName") } : {}),
      ...(!editingObject ? {
        nameFieldType: form.get("nameFieldType"),
        nameUnique: form.get("nameUnique") === "on",
        autoNumberPrefix: form.get("autoNumberPrefix") || "",
        autoNumberSuffix: form.get("autoNumberSuffix") || "",
        autoNumberStart: Number(form.get("autoNumberStart") || 1),
        autoNumberDigits: Number(form.get("autoNumberDigits") || 4),
      } : {}),
    };
    const result = await send(editingObject ? `/api/crm-setup/objects/${editingObject.id}` : "/api/crm-setup/objects", editingObject ? "PATCH" : "POST", body) as CrmObjectRow | null;
    if (!result) return;
    setObjectDialog(false);
    setEditingObject(null);
    await loadObjects();
    setSelectedId(result.id);
  }

  async function createField(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const dataType = editingField?.dataType || fieldTypeForDialog;
    const options = String(form.get("picklistValues") || "").split(",").map((value) => value.trim()).filter(Boolean);
    const body = {
      label: form.get("label"),
      required: dataType === "AUTO_NUMBER" || form.get("required") === "on",
      unique: form.get("unique") === "on",
      externalId: form.get("externalId") === "on",
      ...(dataType === "TEXT" ? { fieldLength: Number(form.get("fieldLength") || 80) } : {}),
      ...(["NUMBER", "CURRENCY", "PERCENT"].includes(dataType) && form.get("decimalPlaces") !== "" ? { decimalPlaces: Number(form.get("decimalPlaces")) } : {}),
      ...(!editingField && dataType === "AUTO_NUMBER" ? {
        autoNumberPrefix: form.get("autoNumberPrefix") || "",
        autoNumberSuffix: form.get("autoNumberSuffix") || "",
        autoNumberStart: Number(form.get("autoNumberStart") || 1),
        autoNumberDigits: Number(form.get("autoNumberDigits") || 4),
      } : {}),
      defaultValue: form.get("defaultValue") || null,
      description: form.get("description") || null,
      helpText: form.get("helpText") || null,
      ...(["PICKLIST", "MULTI_SELECT_PICKLIST"].includes(dataType) ? { picklistValues: options.map((value) => ({ value, label: value })) } : {}),
      ...(!editingField ? { apiName: form.get("apiName"), dataType } : {}),
      ...(!editingField && dataType === "LOOKUP" ? {
        relatedObjectId: form.get("relatedObjectId"),
        relationshipType: "LOOKUP",
      } : {}),
    };
    const result = await send(editingField
      ? `/api/crm-setup/objects/${selected.id}/fields/${editingField.id}`
      : `/api/crm-setup/objects/${selected.id}/fields`,
    editingField ? "PATCH" : "POST", body);
    if (!result) return;
    setFieldDialog(false);
    setEditingField(null);
    await loadObjects();
  }

  async function toggleField(field: CrmFieldRow) {
    if (!selected || !await send(`/api/crm-setup/objects/${selected.id}/fields/${field.id}`, "PATCH", { active: !field.active })) return;
    await loadObjects();
  }

  async function deleteField(field: CrmFieldRow) {
    if (!selected || !window.confirm(`Permanently delete the ${field.label} field definition?`)) return;
    if (!await send(`/api/crm-setup/objects/${selected.id}/fields/${field.id}`, "DELETE")) return;
    await loadObjects();
  }

  async function toggleActive(object: CrmObjectRow) {
    if (!await send(`/api/crm-setup/objects/${object.id}`, "PATCH", { active: !object.active })) return;
    await loadObjects();
  }

  async function deleteObject(object: CrmObjectRow) {
    if (!window.confirm(`Permanently delete the custom object ${object.name}? Standard objects and their data are protected.`)) return;
    if (!await send(`/api/crm-setup/objects/${object.id}`, "DELETE")) return;
    await loadObjects();
  }

  const activeCount = useMemo(() => objects.filter((object) => object.active).length, [objects]);
  const visibleFields = selected?.fields.filter((field) => {
    if (fieldFilter === "STANDARD") return field.origin !== "CUSTOM";
    if (fieldFilter === "CUSTOM") return field.origin === "CUSTOM";
    if (fieldFilter === "READ_ONLY") return field.readOnly || field.dataType === "AUTO_NUMBER";
    if (fieldFilter === "EDITABLE") return !field.readOnly && field.dataType !== "AUTO_NUMBER";
    return true;
  }) || [];

  return <section className="crm-manager">
    <nav className="crm-setup-tabs" aria-label="CRM Setup managers">
      {([
        ["objects", "Objects & Fields"],
        ["relationships", "Relationships"],
        ["apps", "App Manager"],
        ["layouts", "Page Layouts"],
        ["users", "Users"],
        ["profiles", "Profiles"],
        ["permission-sets", "Permission Sets"],
        ["role-hierarchy", "Roles & Hierarchy"],
        ["sharing", "Sharing Rules"],
        ["login-history", "Login History"],
        ["audit-logs", "Audit Logs"],
        ["effective-permissions", "Effective Permissions"],
        ["security", "Security Settings"],
      ] as const).map(([id, label]) => <button key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    {section === "users" && <CrmUserManager />}
    {section === "profiles" && <CrmProfileManager />}
    {section === "permission-sets" && <CrmPermissionSetManager />}
    {section === "role-hierarchy" && <CrmRoleHierarchyManager />}
    {section === "sharing" && <CrmSharingManager objects={objects} />}
    {section === "login-history" && <CrmSecurityInsightsManager view="login-history" />}
    {section === "audit-logs" && <CrmSecurityInsightsManager view="audit-logs" />}
    {section === "effective-permissions" && <CrmSecurityInsightsManager view="effective-permissions" />}
    {section === "security" && <SmtpConnectionTest />}
    {section === "relationships" && <RelationshipManager objects={objects} />}
    {section === "apps" && <AppManager objects={objects} />}
    {section === "layouts" && <PageLayoutManager />}
    {section === "objects" && <>
    <div className="crm-manager-toolbar">
      <div className="crm-manager-summary"><strong>{objects.length} objects</strong><span>{activeCount} active · metadata from PostgreSQL</span></div>
      <button className="button button-primary" onClick={() => { setError(""); setEditingObject(null); setNameFieldType("TEXT"); setAutoNumberPreview({ prefix: "", suffix: "", start: "1", digits: "4" }); setObjectDialog(true); }}><CirclePlus size={16} /> New custom object</button>
    </div>
    {error && <p className="crm-setup-error" role="alert">{error}</p>}
    <div className="crm-manager-filters">
      <label className="crm-manager-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search objects…" aria-label="Search CRM objects" /></label>
      <label><span>Module</span><select value={module} onChange={(event) => setModule(event.target.value)}><option value="">All modules</option><option value="SALES">Sales</option><option value="SERVICE">Service</option><option value="COMMON">Common</option></select></label>
      <label><span>Type</span><select value={objectType} onChange={(event) => setObjectType(event.target.value)}><option value="">All types</option><option value="STANDARD">Standard</option><option value="CUSTOM">Custom</option><option value="SYSTEM">System</option></select></label>
    </div>
    <div className="crm-manager-grid">
      <section className="panel crm-manager-object-list" aria-label="CRM objects">
        <div className="crm-panel-heading"><div><h2>Object Registry</h2><p>Standard and custom objects share this registry.</p></div></div>
        {loading ? <div className="crm-setup-loading">Loading database objects…</div> : objects.length ? objects.map((object) => (
          <button key={object.id} className={`crm-manager-object ${selectedId === object.id ? "active" : ""}`} onClick={() => setSelectedId(object.id)}>
            <span className="crm-object-icon"><Database size={16} /></span>
            <span className="crm-field-main"><strong>{object.pluralLabel}</strong><small>{object.apiName} · {object.module.toLowerCase()}</small></span>
            <span className={`crm-manager-status ${object.active ? "active" : ""}`}>{object.active ? "Active" : "Inactive"}</span>
          </button>
        )) : <p className="panel-empty-copy">No CRM objects match these filters.</p>}
      </section>
      {selected && <section className="panel crm-manager-details">
        <div className="crm-object-title">
          <span className="crm-object-icon"><Building2 size={20} /></span>
          <div><span className="eyebrow">{selected.objectType} OBJECT · {selected.module}</span><h2>{selected.pluralLabel}</h2><p>{selected.description || selected.name}</p></div>
          <div className="crm-manager-actions">
            <button className="button button-quiet" onClick={() => void toggleActive(selected)} disabled={saving}>{selected.active ? <EyeOff size={15} /> : <Eye size={15} />}{selected.active ? "Deactivate" : "Activate"}</button>
            {selected.objectType === "CUSTOM" && <button className="icon-button crm-danger-action" aria-label={`Delete ${selected.name}`} onClick={() => void deleteObject(selected)} disabled={saving}><Trash2 size={16} /></button>}
          </div>
        </div>
        <div className="crm-object-meta">
          <div><span>API name</span><strong>{selected.apiName}</strong></div>
          <div><span>Records</span><strong>{selected.recordCount.toLocaleString()}</strong></div>
          <div><span>Fields</span><strong>{selected.fields.length}</strong></div>
          <div><span>Record name field</span><strong>{selected.displayFieldApiName || "—"}</strong></div>
          <div><span>App assignment</span><strong>{selected.active && selected.objectType !== "SYSTEM" ? "Available" : "Unavailable"}</strong></div>
        </div>
        <div className="crm-manager-object-actions">
          {selected.objectType === "CUSTOM" && <button className="button button-secondary" onClick={() => { setEditingObject(selected); setError(""); setObjectDialog(true); }}>Edit object details</button>}
          {selected.objectType === "CUSTOM" ? <Link className="button button-quiet" href={`/custom/${selected.id}`}><ExternalLink size={14} /> Open records</Link> : selected.objectType === "STANDARD" ? <Link className="button button-quiet" href={`/records/${selected.id}`}><ExternalLink size={14} /> Open records</Link> : <span className="muted-count">System objects do not expose direct record controls.</span>}
        </div>
        <div className="crm-panel-heading"><div><h3>Fields & Relationships</h3><p>Field definitions are shared by object, layouts, and relationships.</p></div><button className="button button-secondary" onClick={() => { setError(""); setEditingField(null); setFieldTypeForDialog("TEXT"); setFieldDialog(true); }} disabled={!selected.active}><ListPlus size={15} /> Add field</button></div>
        <div className="crm-manager-filters">
          <label><span>Field view</span><select value={fieldFilter} onChange={(event) => setFieldFilter(event.target.value as typeof fieldFilter)}>
            <option value="ALL">All Fields</option><option value="STANDARD">Standard Fields</option><option value="CUSTOM">Custom Fields</option><option value="READ_ONLY">Read Only Fields</option><option value="EDITABLE">Editable Fields</option>
          </select></label>
        </div>
        <div className="crm-manager-fields">{visibleFields.map((field) => <div key={field.id} className={`crm-manager-field ${field.active ? "" : "inactive"}`}>
          <span className="crm-field-main"><strong>{field.label}{field.required && " *"}{field.isNameField && " · RECORD NAME"}</strong><small>{field.apiName}{field.unique ? " · UNIQUE" : ""} · {field.origin}{field.readOnly || field.dataType === "AUTO_NUMBER" ? " · READ ONLY" : ""}{field.externalId ? " · EXTERNAL ID" : ""}</small></span>
          <span className="status-badge">{field.dataType === "LOOKUP" && field.lookupTargetApiName ? `LOOKUP (${field.lookupTargetApiName})` : field.dataType.replaceAll("_", " ")}</span>
          <button className="button button-quiet" onClick={() => { setEditingField(field); setFieldTypeForDialog(field.dataType); setFieldDialog(true); }} disabled={field.origin === "SYSTEM"}>{field.active ? "Edit" : "Edit / activate"}</button>
          {!field.protected && <button className="icon-button" aria-label={`${field.active ? "Deactivate" : "Activate"} ${field.label}`} onClick={() => void toggleField(field)}>{field.active ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
          {!field.protected && <button className="icon-button crm-danger-action" aria-label={`Delete ${field.label}`} onClick={() => void deleteField(field)}><Trash2 size={15} /></button>}
        </div>)}</div>
        <div className="crm-manager-related">
          <h3>Relationships</h3>
          {selected.outgoingRelationships.length ? selected.outgoingRelationships.map((relationship) => <div key={relationship.id}><strong>{relationship.label}</strong><span>{relationship.relationshipType.replaceAll("_", " ")} → {relationship.targetObject.pluralLabel}</span></div>) : <p>No relationships configured for this object.</p>}
        </div>
        {selected.objectType === "CUSTOM" && <CrmCustomRecords objectId={selected.id} />}
      </section>}
    </div>

    {objectDialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setObjectDialog(false); }}>
      <section className="panel dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-create-object-title">
        <div className="crm-dialog-header"><div><span className="eyebrow">OBJECT MANAGER</span><h2 id="crm-create-object-title">{editingObject ? "Edit custom object" : "Create custom object"}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => { setObjectDialog(false); setEditingObject(null); }}><X size={18} /></button></div>
        <form className="form-grid crm-setup-form" onSubmit={saveObject}>
          <label className="field"><span>Singular label *</span><input name="name" required maxLength={80} defaultValue={editingObject?.name} placeholder="e.g. Asset" /></label>
          <label className="field"><span>Plural label *</span><input name="pluralLabel" required maxLength={100} defaultValue={editingObject?.pluralLabel} placeholder="e.g. Assets" /></label>
          <label className="field field-full"><span>API name *</span><input name="apiName" required pattern="[A-Za-z][A-Za-z0-9_]{1,63}" maxLength={64} defaultValue={editingObject?.apiName.replace(/__c$/, "")} disabled={Boolean(editingObject)} placeholder="e.g. Asset" /><small>Custom API names receive the __c suffix automatically and cannot be changed after creation.</small></label>
          {!editingObject && <>
            <label className="field"><span>Name field type *</span><select name="nameFieldType" value={nameFieldType} onChange={(event) => setNameFieldType(event.target.value as "TEXT" | "AUTO_NUMBER")}><option value="TEXT">Text</option><option value="AUTO_NUMBER">Auto Number</option></select></label>
            {nameFieldType === "TEXT" && <label className="crm-required-toggle"><input type="checkbox" name="nameUnique" /> Unique Name</label>}
            {nameFieldType === "AUTO_NUMBER" && <>
              <label className="field"><span>Auto Number prefix</span><input name="autoNumberPrefix" maxLength={40} value={autoNumberPreview.prefix} onChange={(event) => setAutoNumberPreview((current) => ({ ...current, prefix: event.target.value }))} placeholder="e.g. AST-" /></label>
              <label className="field"><span>Auto Number suffix</span><input name="autoNumberSuffix" maxLength={40} value={autoNumberPreview.suffix} onChange={(event) => setAutoNumberPreview((current) => ({ ...current, suffix: event.target.value }))} placeholder="Optional" /></label>
              <label className="field"><span>Starting number</span><input name="autoNumberStart" type="number" min="0" max="2147483646" value={autoNumberPreview.start} onChange={(event) => setAutoNumberPreview((current) => ({ ...current, start: event.target.value }))} required /></label>
              <label className="field"><span>Minimum digit count</span><input name="autoNumberDigits" type="number" min="1" max="12" value={autoNumberPreview.digits} onChange={(event) => setAutoNumberPreview((current) => ({ ...current, digits: event.target.value }))} required /></label>
              <p className="crm-dialog-note field-full">Example preview: {`${autoNumberPreview.prefix}${String(Number(autoNumberPreview.start || 1)).padStart(Number(autoNumberPreview.digits || 4), "0")}${autoNumberPreview.suffix}`}</p>
            </>}
          </>}
          <label className="field"><span>Module *</span><select name="module" defaultValue={editingObject?.module || "COMMON"}><option value="SALES">Sales</option><option value="SERVICE">Service</option><option value="COMMON">Common</option></select></label>
          <label className="field"><span>Icon name</span><input name="icon" defaultValue={editingObject?.icon || "Database"} maxLength={40} /></label>
          <label className="field field-full"><span>Description</span><textarea name="description" rows={3} maxLength={1000} defaultValue={editingObject?.description || ""} /></label>
          <p className="crm-dialog-note field-full">Every object receives a protected Name field, system audit fields, and a record layout. Auto Numbers are generated on the server.</p>
          <div className="form-actions field-full"><button type="button" className="button button-quiet" onClick={() => { setObjectDialog(false); setEditingObject(null); }}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : editingObject ? "Save object" : "Create object"}</button></div>
        </form>
      </section>
    </div>}

    {fieldDialog && selected && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFieldDialog(false); }}>
      <section className="panel dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-create-field-title">
        <div className="crm-dialog-header"><div><span className="eyebrow">{selected.apiName}</span><h2 id="crm-create-field-title">{editingField ? "Edit field" : "Create field"}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => { setFieldDialog(false); setEditingField(null); }}><X size={18} /></button></div>
        <form key={editingField?.id || "new-field"} className="form-grid crm-setup-form" onSubmit={createField}>
          <label className="field"><span>Field label *</span><input name="label" required maxLength={80} defaultValue={editingField?.label} placeholder="e.g. Warranty end date" /></label>
          <label className="field"><span>Data type *</span><select name="dataType" value={editingField?.dataType || fieldTypeForDialog} onChange={(event) => setFieldTypeForDialog(event.target.value)} disabled={Boolean(editingField)}>{fieldTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="field field-full"><span>API name *</span><input name="apiName" required pattern="[A-Za-z][A-Za-z0-9_]{1,63}" maxLength={64} defaultValue={editingField?.apiName} disabled={Boolean(editingField)} placeholder="e.g. WarrantyEndDate" /></label>
          <label className="field"><span>Default value</span><input name="defaultValue" maxLength={1000} defaultValue={editingField?.defaultValue || ""} /></label>
          <label className="field"><span>Field length (Text)</span><input name="fieldLength" type="number" min="1" max="100000" defaultValue={editingField?.fieldLength ?? 80} /></label>
          <label className="field"><span>Decimal places (numeric)</span><input name="decimalPlaces" type="number" min="0" max="10" defaultValue={editingField?.decimalPlaces ?? ""} /></label>
          {fieldTypeForDialog === "AUTO_NUMBER" && !editingField && <>
            <label className="field"><span>Auto Number prefix</span><input name="autoNumberPrefix" maxLength={40} placeholder="e.g. AST-" /></label>
            <label className="field"><span>Auto Number suffix</span><input name="autoNumberSuffix" maxLength={40} /></label>
            <label className="field"><span>Starting number</span><input name="autoNumberStart" type="number" min="0" max="2147483646" defaultValue="1" required /></label>
            <label className="field"><span>Minimum digit count</span><input name="autoNumberDigits" type="number" min="1" max="12" defaultValue="4" required /></label>
          </>}
          <label className="field"><span>Description</span><input name="description" maxLength={1000} defaultValue={editingField?.description || ""} /></label>
          <label className="field field-full"><span>Help text</span><input name="helpText" maxLength={500} defaultValue={editingField?.helpText || ""} /></label>
          <label className="field"><span>Picklist values</span><input name="picklistValues" defaultValue={editingField?.picklistValues.map((value) => value.label).join(", ")} placeholder="New, In progress, Complete" /><small>Comma-separated; used for Picklist and Multi-Select Picklist.</small></label>
          {!editingField && <label className="field"><span>Related object</span><select name="relatedObjectId" defaultValue=""><option value="">Select an object</option>{objects.filter((object) => object.id !== selected.id && object.active).map((object) => <option key={object.id} value={object.id}>{object.pluralLabel}</option>)}</select></label>}
          {fieldTypeForDialog === "AUTO_NUMBER"
            ? <span className="crm-required-toggle">Required · always</span>
            : <label className="crm-required-toggle"><input type="checkbox" name="required" defaultChecked={editingField?.required} disabled={Boolean(editingField?.protected)} /> Required</label>}
          <label className="crm-required-toggle"><input type="checkbox" name="unique" defaultChecked={editingField?.unique} /> Unique</label>
          <label className="crm-required-toggle"><input type="checkbox" name="externalId" defaultChecked={editingField?.externalId} /> External ID</label>
          <p className="crm-dialog-note field-full">Lookups and picklists are stored with field metadata. Auto Number values are generated by the server and can only be added before records exist.</p>
          <div className="form-actions field-full"><button type="button" className="button button-quiet" onClick={() => { setFieldDialog(false); setEditingField(null); }}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : editingField ? "Save field" : "Create field"}</button></div>
        </form>
      </section>
    </div>}
    </>}
  </section>;
}
