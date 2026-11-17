"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Boxes, CirclePlus, Database,
  Eye, EyeOff, GitBranch, LayoutPanelTop, Link2, Plus, Settings2, Trash2, X,
} from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/app-shell";
import {
  isValidApiName,
  makeApiName,
  validateCustomRecord,
  type CustomField,
  type CustomFieldType,
  type CustomObject,
  type CustomRecord,
  type RelationshipKind,
} from "@/lib/custom-crm-model";

const STORAGE_KEY = "anu-computers-crm-custom-model-v1";
const fieldTypes: { value: CustomFieldType; label: string; description: string }[] = [
  { value: "TEXT", label: "Text", description: "Short text, codes, names" },
  { value: "LONG_TEXT", label: "Long text", description: "Notes and descriptions" },
  { value: "NUMBER", label: "Number", description: "Whole or decimal number" },
  { value: "CURRENCY", label: "Currency", description: "Amount in rupees" },
  { value: "DATE", label: "Date", description: "Calendar date" },
  { value: "CHECKBOX", label: "Checkbox", description: "Yes / no value" },
  { value: "PICKLIST", label: "Picklist", description: "Choose from fixed options" },
  { value: "LOOKUP", label: "Relationship", description: "Link to another object" },
];
const relationshipKinds: { value: RelationshipKind; label: string; description: string }[] = [
  { value: "LOOKUP", label: "Lookup", description: "Optional related record; many records may point to one." },
  { value: "MASTER_DETAIL", label: "Master-detail", description: "Required parent; deleting the parent removes its child records." },
  { value: "ONE_TO_ONE", label: "One-to-one", description: "A record can be linked to one unique related record." },
];

type SetupTab = "objects" | "relationships" | "layouts";
type RecordValues = Record<string, string | number | boolean | null>;
type RelationshipRecord = { id: string; label: string };
type StandardObjectTarget = { id: string; label: string; pluralLabel: string; records: RelationshipRecord[] };

const standardTargets: StandardObjectTarget[] = [
  { id: "standard:customers", label: "Customer", pluralLabel: "Customers", records: [
    { id: "customer-1", label: "Bright Tech Solutions" },
    { id: "customer-2", label: "City Edu Institute" },
    { id: "customer-3", label: "Greenfield Traders" },
  ] },
  { id: "standard:leads", label: "Lead", pluralLabel: "Leads", records: [
    { id: "lead-1", label: "Bright Tech Solutions" },
    { id: "lead-2", label: "City Edu Institute" },
    { id: "lead-3", label: "Greenfield Traders" },
  ] },
  { id: "standard:products", label: "Product", pluralLabel: "Products", records: [
    { id: "product-1", label: "14-inch Business Laptop" },
    { id: "product-2", label: "AT32 Control IC" },
    { id: "product-3", label: "24-inch FHD Monitor" },
  ] },
  { id: "standard:quotes", label: "Quote", pluralLabel: "Quotes", records: [
    { id: "quote-1", label: "QUO-2047 · Bright Tech" },
    { id: "quote-2", label: "QUO-2046 · City Edu" },
    { id: "quote-3", label: "QUO-2045 · Greenfield" },
  ] },
  { id: "standard:orders", label: "Order", pluralLabel: "Orders", records: [
    { id: "order-1", label: "ORD-1058 · Bright Tech" },
    { id: "order-2", label: "ORD-1057 · City Edu" },
    { id: "order-3", label: "ORD-1056 · Greenfield" },
  ] },
  { id: "standard:service", label: "Service ticket", pluralLabel: "Service tickets", records: [
    { id: "ticket-1", label: "ST-0312 · Laptop power issue" },
    { id: "ticket-2", label: "ST-0311 · Setup assistance" },
    { id: "ticket-3", label: "ST-0310 · Monitor flicker" },
  ] },
];

function emptyModel(): CustomObject[] {
  return [];
}

function visibleFields(object: CustomObject) {
  return object.layoutFieldIds.map((id) => object.fields.find((field) => field.id === id)).filter((field): field is CustomField => Boolean(field));
}

function fieldValueLabel(field: CustomField, value: string | number | boolean | null, objects: CustomObject[]) {
  if (value === null || value === "") return "—";
  if (field.type === "LOOKUP" && typeof value === "string") {
    return relationshipRecords(field.relatedObjectId, objects).find((record) => record.id === value)?.label || "Missing related record";
  }
  if (field.type === "CHECKBOX") return value ? "Yes" : "No";
  if (field.type === "CURRENCY" && typeof value === "number") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
  return String(value);
}

function relationshipTarget(id: string | undefined, objects: CustomObject[]) {
  return objects.find((object) => object.id === id) || standardTargets.find((object) => object.id === id);
}

function relationshipRecords(id: string | undefined, objects: CustomObject[]): RelationshipRecord[] {
  const target = objects.find((object) => object.id === id);
  if (target) {
    const primary = target.fields[0];
    return target.records.map((record) => ({ id: record.id, label: String(record.values[primary?.id || ""] || "Untitled record") }));
  }
  return standardTargets.find((object) => object.id === id)?.records || [];
}

function validateRelationships(object: CustomObject, objects: CustomObject[], values: RecordValues, editingRecordId?: string) {
  for (const field of object.fields.filter((item) => item.type === "LOOKUP")) {
    const value = values[field.id];
    if (value === null || value === "") continue;
    if (typeof value !== "string") return `Choose a valid related record for ${field.label}.`;
    if (!relationshipRecords(field.relatedObjectId, objects).some((record) => record.id === value)) {
      return `The selected ${field.label} record no longer exists.`;
    }
    if (field.relationshipKind === "ONE_TO_ONE" && object.records.some((record) =>
      record.id !== editingRecordId && record.values[field.id] === value)) {
      return `That ${field.label} record is already linked. Choose another record.`;
    }
  }
  return null;
}

function createsMasterDetailCycle(sourceId: string, targetId: string, objects: CustomObject[]) {
  const visited = new Set<string>();
  const pending = [targetId];
  while (pending.length) {
    const currentId = pending.pop()!;
    if (currentId === sourceId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const current = objects.find((object) => object.id === currentId);
    for (const field of current?.fields || []) {
      if (field.type === "LOOKUP" && field.relationshipKind === "MASTER_DETAIL" && field.relatedObjectId) {
        pending.push(field.relatedObjectId);
      }
    }
  }
  return false;
}

function deleteRecordCascade(objects: CustomObject[], objectId: string, recordId: string, visited = new Set<string>()): CustomObject[] {
  const key = `${objectId}:${recordId}`;
  if (visited.has(key)) return objects;
  visited.add(key);
  const parent = objects.find((object) => object.id === objectId);
  const record = parent?.records.find((item) => item.id === recordId);
  if (!parent || !record) return objects;

  let next = objects;
  for (const child of next) {
    const masterFields = child.fields.filter((field) =>
      field.type === "LOOKUP" && field.relationshipKind === "MASTER_DETAIL" && field.relatedObjectId === objectId);
    for (const masterField of masterFields) {
      const childIds = child.records
        .filter((childRecord) => childRecord.values[masterField.id] === recordId)
        .map((childRecord) => childRecord.id);
      for (const childId of childIds) next = deleteRecordCascade(next, child.id, childId, visited);
    }
  }

  return next.map((object) => object.id === objectId ? {
    ...object,
    records: object.records.filter((item) => item.id !== recordId),
  } : object);
}

export function CrmSetupPreview({ pathname }: { pathname: string }) {
  const router = useRouter();
  const [objects, setObjects] = useState<CustomObject[]>(emptyModel);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<SetupTab>("objects");
  const [selectedId, setSelectedId] = useState("");
  const [objectDialog, setObjectDialog] = useState(false);
  const [fieldDialog, setFieldDialog] = useState(false);
  const [fieldDialogType, setFieldDialogType] = useState<CustomFieldType>("TEXT");
  const [recordDialog, setRecordDialog] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<CustomRecord | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const customRecordId = pathname.startsWith("/custom/") ? pathname.split("/")[2] : "";
  const selectedObject = objects.find((object) => object.id === selectedId) || objects[0];
  const customRecordObject = objects.find((object) => object.id === customRecordId);

  function openFieldDialog(type: CustomFieldType = "TEXT") {
    setFieldDialogType(type);
    setError("");
    setFieldDialog(true);
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setObjects(parsed as CustomObject[]);
          setSelectedId((parsed[0] as CustomObject | undefined)?.id || "");
        } else {
          throw new Error("Saved custom CRM setup has an unsupported format.");
        }
      }
    } catch (caught) {
      console.error("Could not load custom CRM setup.", caught);
      setError("Could not load CRM Setup saved in this browser.");
    } finally {
      setLoaded(true);
    }
  }, []);

  function save(next: CustomObject[]) {
    setObjects(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setError("");
    } catch (caught) {
      console.error("Could not save custom CRM setup.", caught);
      setError("Could not save CRM Setup in this browser. Check available storage.");
    }
  }

  const relationships = useMemo(() => objects.flatMap((object) => object.fields
    .filter((field) => field.type === "LOOKUP" && field.relatedObjectId)
    .map((field) => ({ object, field, target: relationshipTarget(field.relatedObjectId, objects) }))), [objects]);

  function createObject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") || "").trim();
    const pluralLabel = String(form.get("pluralLabel") || "").trim();
    const apiName = makeApiName(String(form.get("apiName") || label));
    if (!label || !pluralLabel || !isValidApiName(apiName)) {
      setError("Enter an object name and a valid API name (letters, numbers, underscores; start with a letter).");
      return;
    }
    if (objects.some((object) => object.apiName.toLowerCase() === apiName.toLowerCase())) {
      setError("That API name is already in use.");
      return;
    }
    const id = crypto.randomUUID();
    const nameField: CustomField = { id: crypto.randomUUID(), label: "Name", apiName: "name", type: "TEXT", required: true, options: [] };
    const object: CustomObject = {
      id, label, pluralLabel, apiName, description: String(form.get("description") || "").trim(),
      fields: [nameField], layoutFieldIds: [nameField.id], records: [], createdAt: new Date().toISOString(),
    };
    save([object, ...objects]);
    setSelectedId(id);
    setTab("objects");
    setObjectDialog(false);
    event.currentTarget.reset();
  }

  function createField(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedObject) return;
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") || "").trim();
    const type = String(form.get("type")) as CustomFieldType;
    const apiName = makeApiName(String(form.get("apiName") || label));
    const relatedObjectId = String(form.get("relatedObjectId") || "");
    const relationshipKind = String(form.get("relationshipKind") || "LOOKUP") as RelationshipKind;
    const options = String(form.get("options") || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!label || !isValidApiName(apiName)) {
      setError("Enter a field label and a valid API name.");
      return;
    }
    if (selectedObject.fields.some((field) => field.apiName.toLowerCase() === apiName.toLowerCase())) {
      setError("That field API name already exists on this object.");
      return;
    }
    if (type === "LOOKUP" && (!relatedObjectId || relatedObjectId === selectedObject.id ||
        (!objects.some((object) => object.id === relatedObjectId) && !standardTargets.some((object) => object.id === relatedObjectId)))) {
      setError("Choose a different object for this relationship.");
      return;
    }
    if (type === "LOOKUP" && relationshipKind === "MASTER_DETAIL" &&
        createsMasterDetailCycle(selectedObject.id, relatedObjectId, objects)) {
      setError("This master-detail relationship would create a circular parent relationship.");
      return;
    }
    if (selectedObject.records.length > 0 &&
        (form.get("required") === "on" || (type === "LOOKUP" && relationshipKind === "MASTER_DETAIL"))) {
      setError("A required field cannot be added after records exist. Add it as optional, or create it before adding records.");
      return;
    }
    if (type === "PICKLIST" && !options.length) {
      setError("Add at least one comma-separated picklist option.");
      return;
    }
    const field: CustomField = {
      id: crypto.randomUUID(), label, apiName, type, required: form.get("required") === "on", options,
      ...(type === "LOOKUP" ? { relatedObjectId, relationshipKind } : {}),
    };
    const next = objects.map((object) => object.id === selectedObject.id ? {
      ...object, fields: [...object.fields, field], layoutFieldIds: [...object.layoutFieldIds, field.id],
    } : object);
    save(next);
    setFieldDialog(false);
    event.currentTarget.reset();
  }

  function removeObject(object: CustomObject) {
    if (!window.confirm(`Delete ${object.label}, its fields and ${object.records.length} browser-demo records? Relationships pointing to it will also be removed.`)) return;
    let withoutObjectRecords = objects;
    for (const record of object.records) {
      withoutObjectRecords = deleteRecordCascade(withoutObjectRecords, object.id, record.id);
    }
    const next = withoutObjectRecords.filter((item) => item.id !== object.id).map((item) => ({
      ...item,
      fields: item.fields.filter((field) => field.relatedObjectId !== object.id),
      layoutFieldIds: item.layoutFieldIds.filter((fieldId) => item.fields.some((field) => field.id === fieldId && field.relatedObjectId !== object.id)),
      records: item.records.map((record) => {
        const values = { ...record.values };
        for (const field of item.fields.filter((candidate) => candidate.relatedObjectId === object.id)) delete values[field.id];
        return { ...record, values };
      }),
    }));
    save(next);
    if (selectedId === object.id) setSelectedId(next[0]?.id || "");
    if (customRecordId === object.id) router.push("/crm-setup");
  }

  function deleteField(field: CustomField) {
    if (!selectedObject || field.apiName === "name") return;
    if (!window.confirm(`Delete the ${field.label} field and its values from all ${selectedObject.records.length} records?`)) return;
    save(objects.map((object) => object.id === selectedObject.id ? {
      ...object,
      fields: object.fields.filter((item) => item.id !== field.id),
      layoutFieldIds: object.layoutFieldIds.filter((id) => id !== field.id),
      records: object.records.map((record) => {
        const values = { ...record.values };
        delete values[field.id];
        return { ...record, values };
      }),
    } : object));
  }

  function moveLayoutField(fieldId: string, offset: -1 | 1) {
    if (!selectedObject) return;
    const current = [...selectedObject.layoutFieldIds];
    const index = current.indexOf(fieldId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    save(objects.map((object) => object.id === selectedObject.id ? { ...object, layoutFieldIds: current } : object));
  }

  function toggleLayoutField(fieldId: string) {
    if (!selectedObject) return;
    const field = selectedObject.fields.find((item) => item.id === fieldId);
    if (field && (field.required || field.apiName === "name" ||
        (field.type === "LOOKUP" && field.relationshipKind === "MASTER_DETAIL"))) return;
    const current = selectedObject.layoutFieldIds;
    const nextLayout = current.includes(fieldId) ? current.filter((id) => id !== fieldId) : [...current, fieldId];
    save(objects.map((object) => object.id === selectedObject.id ? { ...object, layoutFieldIds: nextLayout } : object));
  }

  function createRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedObject) return;
    const form = new FormData(event.currentTarget);
    const values: RecordValues = {};
    for (const field of selectedObject.fields) {
      const raw = form.get(field.id);
      if (field.type === "CHECKBOX") values[field.id] = raw === "on";
      else if (raw === null || raw === "") values[field.id] = null;
      else if (field.type === "NUMBER" || field.type === "CURRENCY") values[field.id] = Number(raw);
      else values[field.id] = String(raw);
    }
    const validationError = validateCustomRecord(selectedObject.fields, values);
    const relationError = validateRelationships(selectedObject, objects, values);
    if (validationError || relationError) {
      setError(validationError || relationError || "Review the record fields.");
      return;
    }
    const record: CustomRecord = { id: crypto.randomUUID(), values, createdAt: new Date().toISOString() };
    save(objects.map((object) => object.id === selectedObject.id ? { ...object, records: [record, ...object.records] } : object));
    setRecordDialog(false);
    event.currentTarget.reset();
  }

  function updateRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customRecordObject || !selectedRecord) return;
    const form = new FormData(event.currentTarget);
    const values: RecordValues = {};
    for (const field of customRecordObject.fields) {
      if (!visibleFields(customRecordObject).some((visibleField) => visibleField.id === field.id)) {
        values[field.id] = selectedRecord.values[field.id] ?? null;
        continue;
      }
      const raw = form.get(field.id);
      if (field.type === "CHECKBOX") values[field.id] = raw === "on";
      else if (raw === null || raw === "") values[field.id] = null;
      else if (field.type === "NUMBER" || field.type === "CURRENCY") values[field.id] = Number(raw);
      else values[field.id] = String(raw);
    }
    const validationError = validateCustomRecord(customRecordObject.fields, values);
    const relationError = validateRelationships(customRecordObject, objects, values, selectedRecord.id);
    if (validationError || relationError) {
      setError(validationError || relationError || "Review the record fields.");
      return;
    }
    save(objects.map((object) => object.id === customRecordObject.id ? {
      ...object, records: object.records.map((record) => record.id === selectedRecord.id ? { ...record, values } : record),
    } : object));
    setSelectedRecord({ ...selectedRecord, values });
    setError("");
  }

  function deleteRecord(record: CustomRecord) {
    if (!customRecordObject || !window.confirm("Delete this browser-demo record?")) return;
    save(deleteRecordCascade(objects, customRecordObject.id, record.id));
    setSelectedRecord(null);
  }

  if (!loaded) return <div className="crm-setup-loading" role="status">Loading CRM Setup…</div>;
  if (customRecordId && customRecordObject) return <CustomRecordsPage
    object={customRecordObject}
    objects={objects}
    search={search}
    selectedRecord={selectedRecord}
    onSearch={setSearch}
    onBack={() => router.push("/crm-setup")}
    onCreate={() => setRecordDialog(true)}
    onSelect={setSelectedRecord}
    onCloseRecord={() => setSelectedRecord(null)}
    onCreateRecord={createRecord}
    onUpdateRecord={updateRecord}
    onDeleteRecord={deleteRecord}
    recordDialog={recordDialog}
    onCloseCreate={() => setRecordDialog(false)}
    error={error}
  />;

  return <>
    <PageHeader eyebrow="ADMINISTRATION" title="CRM Setup" description="Create custom objects, fields, layouts, and relationships for your team."
      action={<button className="button button-primary" onClick={() => { setError(""); setObjectDialog(true); }}><CirclePlus size={16} /> New object</button>} />
    <div className="crm-setup-notice"><strong>Browser demo setup</strong><span>Object definitions and records are saved in this browser only. They are not yet shared with your team or connected to PostgreSQL.</span></div>
    <div className="crm-setup-tabs" role="tablist" aria-label="CRM Setup sections">
      <button role="tab" aria-selected={tab === "objects"} className={tab === "objects" ? "active" : ""} onClick={() => setTab("objects")}><Boxes size={16} /> Objects &amp; fields</button>
      <button role="tab" aria-selected={tab === "relationships"} className={tab === "relationships" ? "active" : ""} onClick={() => setTab("relationships")}><GitBranch size={16} /> Relationships <span className="crm-tab-count">{relationships.length}</span></button>
      <button role="tab" aria-selected={tab === "layouts"} className={tab === "layouts" ? "active" : ""} onClick={() => setTab("layouts")}><LayoutPanelTop size={16} /> Record layouts</button>
    </div>
    {error && <div className="crm-setup-error" role="alert">{error}</div>}
    {tab === "objects" && <div className="crm-setup-grid">
      <ObjectList objects={objects} selectedId={selectedObject?.id || ""} onSelect={setSelectedId} onCreate={() => setObjectDialog(true)} />
      {selectedObject ? <ObjectEditor
        object={selectedObject}
        objects={objects}
        onAddField={() => openFieldDialog()}
        onDeleteField={deleteField}
        onDeleteObject={() => removeObject(selectedObject)}
        onOpenRecords={() => router.push(`/custom/${selectedObject.id}`)}
      /> : <section className="panel crm-setup-empty"><EmptyState title="Create your first object" description="Custom objects hold the records and business data your team wants to track." /><button className="button button-primary" onClick={() => setObjectDialog(true)}><CirclePlus size={16} /> Create object</button></section>}
    </div>}
    {tab === "relationships" && <RelationshipsPanel
      relationships={relationships}
      onSelectObject={(id) => { setSelectedId(id); setTab("objects"); }}
      onCreateRelationship={() => {
        if (!objects.length) {
          setError("Create a custom object before adding a relationship.");
          setTab("objects");
          return;
        }
        setSelectedId(objects[0].id);
        openFieldDialog("LOOKUP");
      }}
    />}
    {tab === "layouts" && <LayoutEditor object={selectedObject} onSelectObject={setSelectedId} objects={objects} onMove={moveLayoutField} onToggle={toggleLayoutField} />}
    {objectDialog && <ObjectDialog onClose={() => setObjectDialog(false)} onSubmit={createObject} error={error} />}
    {fieldDialog && selectedObject && <FieldDialog object={selectedObject} objects={objects} initialType={fieldDialogType} onClose={() => setFieldDialog(false)} onSubmit={createField} error={error} />}
  </>;
}

function ObjectList({ objects, selectedId, onSelect, onCreate }: {
  objects: CustomObject[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return <section className="panel crm-object-list">
    <div className="crm-panel-heading"><div><h2>Custom objects</h2><p>{objects.length} objects</p></div><button className="icon-button" aria-label="Add object" onClick={onCreate}><Plus size={18} /></button></div>
    {objects.length ? <div className="crm-object-items">{objects.map((object) => <button key={object.id} className={`crm-object-item ${object.id === selectedId ? "selected" : ""}`} onClick={() => onSelect(object.id)}>
      <span className="crm-object-icon"><Database size={16} /></span><span className="crm-object-label"><strong>{object.pluralLabel}</strong><small>{object.fields.length} fields · {object.records.length} records</small></span><ArrowRight size={15} />
    </button>)}</div> : <div className="crm-object-empty">Create custom objects to model your business data.</div>}
    <button className="crm-object-create" onClick={onCreate}><CirclePlus size={15} /> Create a custom object</button>
  </section>;
}

function ObjectEditor({ object, objects, onAddField, onDeleteField, onDeleteObject, onOpenRecords }: {
  object: CustomObject;
  objects: CustomObject[];
  onAddField: () => void;
  onDeleteField: (field: CustomField) => void;
  onDeleteObject: () => void;
  onOpenRecords: () => void;
}) {
  return <section className="panel crm-object-editor">
    <div className="crm-object-title">
      <span className="crm-large-icon"><Database size={21} /></span>
      <div><div className="eyebrow">CUSTOM OBJECT</div><h2>{object.pluralLabel}</h2><p>{object.description || object.label}</p></div>
      <button className="button button-outline crm-open-records" onClick={onOpenRecords}>Open records <ArrowRight size={15} /></button>
      <button className="icon-button crm-delete-object" aria-label={`Delete ${object.label}`} onClick={onDeleteObject}><Trash2 size={16} /></button>
    </div>
    <div className="crm-object-meta"><span><small>Label</small><strong>{object.label}</strong></span><span><small>API name</small><strong>{object.apiName}__c</strong></span><span><small>Records</small><strong>{object.records.length}</strong></span></div>
    <div className="crm-panel-heading crm-fields-heading"><div><h3>Fields &amp; relationships</h3><p>Fields define the data stored on each record.</p></div><button className="button button-outline" onClick={onAddField}><Plus size={15} /> New field</button></div>
    {object.fields.length ? <div className="crm-field-list">{object.fields.map((field) => {
      const target = relationshipTarget(field.relatedObjectId, objects);
      return <div className="crm-field-row" key={field.id}>
        <span className="crm-field-type-icon">{field.type === "LOOKUP" ? <Link2 size={15} /> : <Settings2 size={15} />}</span>
        <span className="crm-field-main"><strong>{field.label}{(field.required || field.relationshipKind === "MASTER_DETAIL") && <i>*</i>}</strong><small>{field.apiName}{field.type === "LOOKUP" && target ? ` · ${target.label} · ${field.relationshipKind?.replaceAll("_", " ")}` : ""}</small></span>
        <StatusBadge>{fieldTypes.find((item) => item.value === field.type)?.label || field.type}</StatusBadge>
        {field.apiName !== "name" && <button className="icon-button crm-delete-field" aria-label={`Delete ${field.label}`} onClick={() => onDeleteField(field)}><Trash2 size={15} /></button>}
      </div>;
    })}</div> : <EmptyState title="No fields yet" description="Add fields to define what each record stores." />}
  </section>;
}

function RelationshipsPanel({ relationships, onSelectObject, onCreateRelationship }: {
  relationships: { object: CustomObject; field: CustomField; target?: CustomObject | StandardObjectTarget }[];
  onSelectObject: (id: string) => void;
  onCreateRelationship: () => void;
}) {
  return <>
    <div className="crm-relationships-header"><div><h2>Object relationships</h2><p>Connect custom objects to each other or to standard CRM objects.</p></div><button className="button button-primary" onClick={onCreateRelationship}><CirclePlus size={16} /> New relationship</button></div>
    {relationships.length ? <div className="crm-relationship-list">{relationships.map(({ object, field, target }) => <article className="panel crm-relationship-card" key={field.id}>
      <div className="crm-relationship-object"><span className="crm-object-icon"><Database size={17} /></span><div><strong>{object.pluralLabel}</strong><small>{field.label} · {field.apiName}</small></div></div>
      <div className="crm-relationship-line"><span /><Link2 size={17} /><span /></div>
      <div className="crm-relationship-kind"><StatusBadge>{field.relationshipKind?.replaceAll("_", " ") || "LOOKUP"}</StatusBadge><small>{field.relationshipKind === "ONE_TO_ONE" ? "One record ↔ one record" : field.relationshipKind === "MASTER_DETAIL" ? "Required parent · cascade delete" : "Many records → one record"}</small></div>
      <div className="crm-relationship-object"><span className="crm-object-icon"><Database size={17} /></span><div><strong>{target?.pluralLabel || "Missing object"}</strong><small>{target && "apiName" in target ? `${target.apiName}__c` : target?.id || field.relatedObjectId}</small></div></div>
      <button className="button button-quiet" onClick={() => onSelectObject(object.id)}>Edit field</button>
    </article>)}</div> : <section className="panel crm-empty-relationships"><div className="crm-empty-icon"><GitBranch size={23} /></div><h3>No relationships defined</h3><p>Link one custom object to another using lookup, master-detail, or one-to-one relationships.</p><button className="button button-primary" onClick={onCreateRelationship}><CirclePlus size={16} /> Create relationship</button></section>}
    <div className="crm-relationship-help"><strong>Relationship types</strong><span><b>Lookup</b> keeps a flexible optional link.</span><span><b>Master-detail</b> requires a parent and removes children with the parent in this demo.</span><span><b>One-to-one</b> prevents multiple records from using the same related record.</span></div>
  </>;
}

function LayoutEditor({ object, objects, onSelectObject, onMove, onToggle }: {
  object?: CustomObject;
  objects: CustomObject[];
  onSelectObject: (id: string) => void;
  onMove: (fieldId: string, offset: -1 | 1) => void;
  onToggle: (fieldId: string) => void;
}) {
  const ordered = object ? [
    ...visibleFields(object),
    ...object.fields.filter((field) => !object.layoutFieldIds.includes(field.id)),
  ] : [];
  return <>
    <div className="crm-layout-toolbar"><div><h2>Record layouts</h2><p>Choose visible fields and order them in the record form.</p></div>
      {objects.length > 0 && <label className="crm-object-select"><span>Object</span><select value={object?.id || ""} onChange={(event) => onSelectObject(event.target.value)}>{objects.map((item) => <option value={item.id} key={item.id}>{item.pluralLabel}</option>)}</select></label>}
    </div>
    {object ? <div className="crm-layout-grid">
      <section className="panel crm-layout-fields"><div className="crm-panel-heading"><div><h3>Field order</h3><p>Use arrows to change display order.</p></div></div>
        {ordered.map((field) => {
          const index = object.layoutFieldIds.indexOf(field.id);
          const visible = index >= 0;
          const canHide = !field.required && field.apiName !== "name" &&
            !(field.type === "LOOKUP" && field.relationshipKind === "MASTER_DETAIL");
          return <div className={`crm-layout-field ${visible ? "" : "hidden"}`} key={field.id}>
            <span className="crm-field-grip">⋮⋮</span><span className="crm-field-main"><strong>{field.label}</strong><small>{field.type === "LOOKUP" ? field.relationshipKind?.replaceAll("_", " ") || "LOOKUP" : field.type.replaceAll("_", " ")}</small></span>
            <button className="icon-button" aria-label={`Move ${field.label} up`} disabled={!visible || index === 0} onClick={() => onMove(field.id, -1)}><ArrowUp size={15} /></button>
            <button className="icon-button" aria-label={`Move ${field.label} down`} disabled={!visible || index === object.layoutFieldIds.length - 1} onClick={() => onMove(field.id, 1)}><ArrowDown size={15} /></button>
            <button className="icon-button" aria-label={`${visible ? "Hide" : "Show"} ${field.label}`} disabled={!canHide && visible} onClick={() => onToggle(field.id)}>{visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
          </div>;
        })}
      </section>
      <section className="panel crm-layout-preview"><div className="crm-panel-heading"><div><h3>Form preview</h3><p>{object.label} record</p></div><span className="crm-live-preview">LIVE PREVIEW</span></div>
        <div className="crm-preview-form">
          {visibleFields(object).map((field) => <label className="field" key={field.id}><span>{field.label}{(field.required || field.relationshipKind === "MASTER_DETAIL") && " *"}</span>{field.type === "LONG_TEXT" ? <textarea disabled rows={3} placeholder={field.label} /> : field.type === "CHECKBOX" ? <span className="crm-preview-checkbox"><input type="checkbox" disabled /> Yes</span> : field.type === "PICKLIST" || field.type === "LOOKUP" ? <select disabled><option>{field.type === "LOOKUP" ? `Select ${relationshipTarget(field.relatedObjectId, objects)?.label || "record"}` : "Select option"}</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input disabled type={field.type === "DATE" ? "date" : field.type === "NUMBER" || field.type === "CURRENCY" ? "number" : "text"} placeholder={field.label} />}</label>)}
          {!visibleFields(object).length && <p className="crm-layout-no-fields">Show fields to add them to this layout.</p>}
        </div>
      </section>
    </div> : <section className="panel crm-setup-empty"><EmptyState title="Create an object to design its layout" description="Record layouts are configured separately for each custom object." /></section>}
  </>;
}

function ObjectDialog({ onClose, onSubmit, error }: { onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; error: string }) {
  const [label, setLabel] = useState("");
  const [apiName, setApiName] = useState("");
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="create-object-title">
      <div className="dialog-header"><div><div className="eyebrow">OBJECT MANAGER</div><h2 id="create-object-title">Create custom object</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={onSubmit}><div className="form-grid">
        <label className="field"><span>Singular label *</span><input name="label" required maxLength={60} value={label} onChange={(event) => { setLabel(event.target.value); setApiName(makeApiName(event.target.value)); }} placeholder="e.g. Service Visit" /></label>
        <label className="field"><span>Plural label *</span><input name="pluralLabel" required maxLength={60} placeholder="e.g. Service Visits" /></label>
        <label className="field field-full"><span>API name *</span><input name="apiName" required value={apiName} onChange={(event) => setApiName(makeApiName(event.target.value))} placeholder="service_visit" /><small className="crm-field-hint">Stable identifier used by integrations; custom objects use the __c suffix.</small></label>
        <label className="field field-full"><span>Description</span><textarea name="description" rows={2} maxLength={240} placeholder="What your team tracks with this object" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="crm-dialog-note">A required Name field and a starter record layout will be created automatically.</p>
      <div className="dialog-footer"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary"><CirclePlus size={15} /> Create object</button></div></form>
    </section>
  </div>;
}

function FieldDialog({ object, objects, initialType, onClose, onSubmit, error }: {
  object: CustomObject;
  objects: CustomObject[];
  initialType: CustomFieldType;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  error: string;
}) {
  const [label, setLabel] = useState("");
  const [apiName, setApiName] = useState("");
  const [type, setType] = useState<CustomFieldType>(initialType);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="create-field-title">
      <div className="dialog-header"><div><div className="eyebrow">{object.label.toUpperCase()} OBJECT</div><h2 id="create-field-title">New field</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={onSubmit}><div className="form-grid">
        <label className="field"><span>Field label *</span><input name="label" required maxLength={60} value={label} onChange={(event) => { setLabel(event.target.value); setApiName(makeApiName(event.target.value)); }} placeholder="e.g. Visit date" /></label>
        <label className="field"><span>Data type *</span><select name="type" value={type} onChange={(event) => setType(event.target.value as CustomFieldType)}>{fieldTypes.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label className="field field-full"><span>API name *</span><input name="apiName" required value={apiName} onChange={(event) => setApiName(makeApiName(event.target.value))} placeholder="visit_date" /></label>
        {type === "PICKLIST" && <label className="field field-full"><span>Options *</span><input name="options" required placeholder="Scheduled, In progress, Completed" /><small className="crm-field-hint">Separate each option with a comma.</small></label>}
        {type === "LOOKUP" && <>
          <label className="field"><span>Related object *</span><select name="relatedObjectId" required defaultValue="">
            <optgroup label="Standard objects">{standardTargets.map((item) => <option key={item.id} value={item.id}>{item.pluralLabel}</option>)}</optgroup>
            {objects.filter((item) => item.id !== object.id).length > 0 && <optgroup label="Custom objects">{objects.filter((item) => item.id !== object.id).map((item) => <option key={item.id} value={item.id}>{item.pluralLabel}</option>)}</optgroup>}
          </select></label>
          <label className="field"><span>Relationship type *</span><select name="relationshipKind" defaultValue="LOOKUP">{relationshipKinds.map((kind) => <option value={kind.value} key={kind.value}>{kind.label}</option>)}</select></label>
          <p className="crm-field-hint field-full">This creates a relationship from {object.pluralLabel} to the selected object. Master-detail fields are required; lookup fields may be left blank.</p>
        </>}
        <label className="crm-required-toggle"><input name="required" type="checkbox" /> <span>Require a value on every record</span></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="crm-dialog-note">New fields are added to the record layout automatically.</p>
      <div className="dialog-footer"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary"><Plus size={15} /> Add field</button></div></form>
    </section>
  </div>;
}

function CustomRecordsPage({ object, objects, search, selectedRecord, onSearch, onBack, onCreate, onSelect, onCloseRecord, onCreateRecord, onUpdateRecord, onDeleteRecord, recordDialog, onCloseCreate, error }: {
  object: CustomObject;
  objects: CustomObject[];
  search: string;
  selectedRecord: CustomRecord | null;
  onSearch: (value: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onSelect: (record: CustomRecord) => void;
  onCloseRecord: () => void;
  onCreateRecord: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdateRecord: (event: React.FormEvent<HTMLFormElement>) => void;
  onDeleteRecord: (record: CustomRecord) => void;
  recordDialog: boolean;
  onCloseCreate: () => void;
  error: string;
}) {
  const primary = object.fields[0];
  const fields = visibleFields(object);
  const records = object.records.filter((record) => fields.map((field) => fieldValueLabel(field, record.values[field.id] ?? null, objects)).join(" ").toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="crm-breadcrumb"><button onClick={onBack}><ArrowLeft size={15} /> CRM Setup</button><span>/</span><strong>{object.pluralLabel}</strong></div>
    <PageHeader eyebrow={`${object.apiName}__c`} title={object.pluralLabel} description={object.description || `Manage ${object.pluralLabel.toLowerCase()} demo records.`}
      action={<button className="button button-primary" onClick={onCreate}><CirclePlus size={16} /> New {object.label.toLowerCase()}</button>} />
    <div className="crm-setup-notice"><strong>Browser demo</strong><span>Records are stored in this browser only.</span></div>
    <div className="toolbar preview-toolbar"><label className="filter-search"><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={`Search ${object.pluralLabel.toLowerCase()}…`} aria-label={`Search ${object.pluralLabel}`} /></label><span className="crm-record-count">{records.length} records</span></div>
    <section className="panel"><div className="table-wrap"><table className="data-table preview-module-table"><thead><tr>{fields.map((field) => <th key={field.id}>{field.label}</th>)}</tr></thead><tbody>
      {records.map((record) => <tr key={record.id} className="preview-clickable-row" onClick={() => onSelect(record)}>{fields.map((field) => <td key={field.id}>{field.id === primary.id ? <strong>{fieldValueLabel(field, record.values[field.id] ?? null, objects)}</strong> : fieldValueLabel(field, record.values[field.id] ?? null, objects)}</td>)}</tr>)}
    </tbody></table></div>
      {!records.length && <EmptyState title={`No ${object.pluralLabel.toLowerCase()} yet`} description="Create a record to try out your fields and relationships." />}
      <div className="preview-table-footer"><span>{records.length} browser-demo records</span><span><LayoutPanelTop size={14} /> {fields.length} layout fields</span></div>
    </section>
    {recordDialog && <CustomRecordDialog title={`New ${object.label}`} object={object} objects={objects} error={error} onClose={onCloseCreate} onSubmit={onCreateRecord} />}
    {selectedRecord && <CustomRecordDialog title={String(selectedRecord.values[primary.id] || object.label)} object={object} objects={objects} record={selectedRecord} error={error} onClose={onCloseRecord} onSubmit={onUpdateRecord} onDelete={() => onDeleteRecord(selectedRecord)} />}
  </>;
}

function CustomRecordDialog({ title, object, objects, record, error, onClose, onSubmit, onDelete }: {
  title: string;
  object: CustomObject;
  objects: CustomObject[];
  record?: CustomRecord;
  error: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
}) {
  const fields = visibleFields(object);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog crm-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-record-title">
      <div className="dialog-header"><div><div className="eyebrow">{object.apiName}__c</div><h2 id="custom-record-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <form key={record?.id || "new"} onSubmit={onSubmit}><div className="form-grid">
        {fields.map((field) => <CustomFieldInput field={field} objects={objects} object={object} recordId={record?.id} value={record?.values[field.id] ?? null} key={field.id} />)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-footer">{onDelete && <button type="button" className="button button-quiet crm-danger-action" onClick={onDelete}><Trash2 size={15} /> Delete</button>}<span className="crm-footer-spacer" /><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary">{record ? "Save changes" : "Create record"}</button></div></form>
    </section>
  </div>;
}

function CustomFieldInput({ field, objects, object, recordId, value }: {
  field: CustomField;
  objects: CustomObject[];
  object: CustomObject;
  recordId?: string;
  value: string | number | boolean | null;
}) {
  const targetObject = relationshipTarget(field.relatedObjectId, objects);
  const isMasterDetail = field.relationshipKind === "MASTER_DETAIL";
  const isRequired = field.required || isMasterDetail;
  const common = { name: field.id, required: isRequired, defaultValue: value === null || typeof value === "boolean" ? "" : String(value), "aria-label": field.label };
  if (field.type === "LONG_TEXT") return <label className="field field-full"><span>{field.label}{isRequired ? " *" : ""}</span><textarea {...common} rows={3} maxLength={4000} /></label>;
  if (field.type === "CHECKBOX") return <label className="crm-record-checkbox"><input type="checkbox" name={field.id} defaultChecked={value === true} /><span>{field.label}{isRequired ? " *" : ""}</span></label>;
  if (field.type === "PICKLIST") return <label className="field"><span>{field.label}{isRequired ? " *" : ""}</span><select {...common}><option value="">Select…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (field.type === "LOOKUP") {
    const usedIds = field.relationshipKind === "ONE_TO_ONE"
      ? new Set(object.records.filter((record) => record.id !== recordId).map((record) => record.values[field.id]))
      : new Set<unknown>();
    const choices = relationshipRecords(field.relatedObjectId, objects).filter((record) => !usedIds.has(record.id));
    return <label className="field"><span>{field.label}{isRequired ? " *" : ""}</span><select {...common}><option value="">Select {targetObject?.label || "record"}…</option>{choices.map((record) => <option value={record.id} key={record.id}>{record.label}</option>)}</select><small className="crm-field-hint">{choices.length ? "Linked record in " + targetObject?.pluralLabel : `Add a ${targetObject?.label || "related"} record first.`}</small></label>;
  }
  const inputType = field.type === "DATE" ? "date" : field.type === "NUMBER" || field.type === "CURRENCY" ? "number" : "text";
  return <label className="field"><span>{field.label}{isRequired ? " *" : ""}</span><input {...common} type={inputType} step={field.type === "CURRENCY" || field.type === "NUMBER" ? "any" : undefined} /></label>;
}
