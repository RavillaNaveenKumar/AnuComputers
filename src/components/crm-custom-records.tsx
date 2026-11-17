"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileUp, Plus, Save, Trash2, X } from "lucide-react";
import Link from "next/link";

type Field = { id: string; label: string; apiName: string; dataType: string; required: boolean; defaultValue: string | null; unique: boolean; canEdit: boolean; origin: "SYSTEM" | "STANDARD" | "CUSTOM"; readOnly: boolean; isNameField: boolean; fieldLength: number | null; decimalPlaces: number | null; lookupTargetApiName: string | null; relationship?: { targetObjectId: string; targetApiName: string; targetPluralLabel: string } | null; picklistValues: { value: string; label: string }[] };
type RecordRow = { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string; canManageShares?: boolean };
type ShareUser = { id: string; name: string; email: string; role: string };
type RecordShare = { id: string; userId: string; access: "READ" | "EDIT"; user: Pick<ShareUser, "name" | "email"> & { active: boolean } };
type LineInput = { productId: string; quantity: string; unitPrice: string; discount: string };
type PendingImport = { records?: Record<string, unknown>[]; csv?: string; count: number };
type RecordPayload = { object: { id: string; name: string; pluralLabel: string; apiName: string; displayFieldApiName: string | null; fields: Field[] }; pageLayout?: { id: string; fieldOrder: string[]; hiddenFieldIds: string[]; requiredFieldIds: string[]; readOnlyFieldIds: string[]; sections: { id: string; label: string; fieldIds?: string[]; columns?: { id: string; fieldIds: string[] }[] }[]; relatedLists: string[]; detailTabs: unknown } | null; capabilities: { canCreate: boolean; canRead: boolean; canEdit: boolean; canDelete: boolean }; lookups?: Record<string, { id: string; label: string }[]>; objectIds?: Record<string, string>; records: RecordRow[]; truncated?: boolean };

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function initialFieldValue(field: Field) {
  if (field.defaultValue === null) return field.dataType === "CHECKBOX" ? false : field.dataType === "MULTI_SELECT_PICKLIST" ? [] : "";
  if (field.dataType === "CHECKBOX") return field.defaultValue === "true";
  if (["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType)) return Number(field.defaultValue);
  if (field.dataType === "MULTI_SELECT_PICKLIST") {
    try {
      const parsed: unknown = JSON.parse(field.defaultValue);
      return Array.isArray(parsed) ? parsed : [field.defaultValue];
    } catch {
      return field.defaultValue.split(",").map((value) => value.trim()).filter(Boolean);
    }
  }
  return field.defaultValue;
}

export function CrmCustomRecords({ objectId, endpoint = `/api/crm-records/${objectId}`, native = false, singleRecord = false }: { objectId: string; endpoint?: string; native?: boolean; singleRecord?: boolean }) {
  const [payload, setPayload] = useState<RecordPayload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [lineItems, setLineItems] = useState<LineInput[]>([]);
  const [sharingRecord, setSharingRecord] = useState<RecordRow | null>(null);
  const [shareUsers, setShareUsers] = useState<ShareUser[]>([]);
  const [recordShares, setRecordShares] = useState<RecordShare[]>([]);
  const [shareUserId, setShareUserId] = useState("");
  const [shareAccess, setShareAccess] = useState<"READ" | "EDIT">("READ");
  const upload = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load records.");
      setPayload(result);
      setSelected([]);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load records."); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  if (!payload) return <section className="crm-custom-records"><h3>Records</h3>{error ? <p className="crm-setup-error">{error}</p> : <p>Loading records…</p>}</section>;
  const fields = payload.object.fields;
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const pageLayout = payload.pageLayout;
  const layoutFields = pageLayout
    ? pageLayout.fieldOrder.flatMap((id) => { const field = fieldById.get(id); return field && !pageLayout.hiddenFieldIds.includes(field.id) ? [field] : []; })
    : fields;
  const layoutRequiredIds = new Set(pageLayout?.requiredFieldIds || []);
  const layoutReadOnlyIds = new Set(pageLayout?.readOnlyFieldIds || []);
  const creating = editing === null;
  const writable = layoutFields.filter((field) => field.canEdit && field.origin !== "SYSTEM" && !field.readOnly && !layoutReadOnlyIds.has(field.id) && field.dataType !== "AUTO_NUMBER" &&
    !(creating && ["Quote", "Case"].includes(payload.object.apiName) && field.apiName === "Status"));
  const writableById = new Map(writable.map((field) => [field.id, field]));
  const formSections = pageLayout?.sections.map((section) => {
    const columns = section.columns?.length ? section.columns.map((column) => column.fieldIds.map((id) => writableById.get(id)).filter((field): field is Field => Boolean(field)))
      : [(section.fieldIds || []).map((id) => writableById.get(id)).filter((field): field is Field => Boolean(field))];
    return { id: section.id, label: section.label, columns: columns.filter((column) => column.length) };
  }).filter((section) => section.columns.length) || [];
  const assignedFormFieldIds = new Set(formSections.flatMap((section) => section.columns.flatMap((column) => column.map((field) => field.id))));
  const remainingFormFields = writable.filter((field) => !assignedFormFieldIds.has(field.id));
  if (remainingFormFields.length) {
    if (formSections.length) formSections[0].columns[0].push(...remainingFormFields);
    else formSections.push({ id: "main", label: "Details", columns: [remainingFormFields] });
  }
  const allSelected = payload.records.length > 0 && selected.length === payload.records.length;
  const primaryField = payload.object.displayFieldApiName || ({
    Account: "Name", Contact: "Name", Lead: "Name", Product: "Name", Quote: "Name",
    QuoteLineItem: "Description", Order: "Name", OrderItem: "Description", Case: "CaseNumber", CaseComment: "Comment",
  } as Record<string, string>)[payload.object.apiName];
  const lookupTargets: Record<string, string> = {
    AccountId: "Account", LeadId: "Lead", QuoteId: "Quote", OrderId: "Order",
    ProductId: "Product", CaseId: "Case",
  };

  function renderRecordField(field: Field) {
    const required = field.required || layoutRequiredIds.has(field.id);
    return <label className="field" key={field.id}><span>{field.label}{required ? " *" : ""}</span>
      {field.dataType === "CHECKBOX" ? <input type="checkbox" checked={Boolean(form[field.apiName])} onChange={(event) => setForm((current) => ({ ...current, [field.apiName]: event.target.checked }))} />
        : field.dataType === "PICKLIST" ? <select required={required} value={String(form[field.apiName] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.apiName]: event.target.value }))}><option value="">Select…</option>{field.picklistValues.map((pick) => <option key={pick.value} value={pick.value}>{pick.label}</option>)}</select>
        : field.dataType === "LOOKUP" ? <select required={required} value={String(form[field.apiName] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.apiName]: event.target.value }))}><option value="">Select…</option>{(payload?.lookups?.[field.apiName] || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        : field.dataType === "MULTI_SELECT_PICKLIST" ? <select multiple required={required} value={Array.isArray(form[field.apiName]) ? form[field.apiName] as string[] : []} onChange={(event) => setForm((current) => ({ ...current, [field.apiName]: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{field.picklistValues.map((pick) => <option key={pick.value} value={pick.value}>{pick.label}</option>)}</select>
        : ["TEXT_AREA", "LONG_TEXT_AREA"].includes(field.dataType) ? <textarea required={required} maxLength={field.fieldLength ?? undefined} rows={4} value={String(form[field.apiName] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.apiName]: event.target.value }))} />
        : <input required={required} maxLength={field.fieldLength ?? undefined} type={["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType) ? "number" : field.dataType === "DATE" ? "date" : field.dataType === "DATETIME" ? "datetime-local" : field.dataType === "EMAIL" ? "email" : field.dataType === "URL" ? "url" : "text"} step={field.decimalPlaces !== null ? 10 ** -field.decimalPlaces : ["CURRENCY", "PERCENT"].includes(field.dataType) ? "0.01" : "any"} value={String(form[field.apiName] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.apiName]: ["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType) && event.target.value !== "" ? Number(event.target.value) : event.target.value }))} />}</label>;
  }

  function startNew() {
    if (!payload) return;
    setEditing(null);
    setForm(Object.fromEntries(writable.map((field) => [field.apiName, initialFieldValue(field)])));
    setLineItems(["Quote", "Order"].includes(payload.object.apiName) ? [{ productId: "", quantity: "1", unitPrice: "0", discount: "0" }] : []);
    setError("");
  }
  function startEdit(row: RecordRow) {
    setEditing(row);
    setForm(Object.fromEntries(writable.map((field) => [field.apiName, row.data[field.apiName] ?? ""])));
    setLineItems([]);
    setError("");
  }
  function closeForm() { setEditing(null); setForm({}); setLineItems([]); }
  async function save() {
    if (!payload) return;
    setBusy(true); setError("");
    try {
      const creatingParent = !editing && ["Quote", "Order"].includes(payload.object.apiName);
      const data = creatingParent ? { ...form, Items: lineItems.map((item) => ({
        ProductId: item.productId,
        Quantity: Number(item.quantity),
        UnitPrice: Number(item.unitPrice),
        ...(payload.object.apiName === "Quote" ? { Discount: Number(item.discount) } : {}),
      })) } : form;
      const response = await fetch(endpoint, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { id: editing.id, data } : { data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save record.");
      closeForm(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save record."); }
    finally { setBusy(false); }
  }
  async function deleteSelected() {
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected record${selected.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const blocked: { id: string; error: string }[] = [];
      let deleted = 0;
      for (let index = 0; index < selected.length; index += 500) {
        const response = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selected.slice(index, index + 500) }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not delete records.");
        deleted += Number(result.deleted || 0);
        if (Array.isArray(result.blocked)) blocked.push(...result.blocked);
      }
      await load();
      if (blocked.length) setError(`${deleted} deleted; ${blocked.length} could not be deleted. ${blocked.slice(0, 3).map((item) => item.error).join(" ")}`);
    } catch (e) {
      await load();
      setError(e instanceof Error ? e.message : "Could not delete records.");
    }
    finally { setBusy(false); }
  }
  function exportRecords() {
    const current = payload;
    if (!current) return;
    const content = JSON.stringify({ object: current.object.apiName, exportedAt: new Date().toISOString(), records: current.records.map(({ data }) => data) }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${current.object.apiName.toLowerCase()}-records.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  function exportCsv() {
    if (!payload) return;
    const anchor = document.createElement("a");
    anchor.href = `${endpoint}${endpoint.includes("?") ? "&" : "?"}format=csv`;
    anchor.download = `${payload.object.apiName.toLowerCase()}-records.csv`;
    anchor.click();
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".csv")) {
        if (!native) throw new Error("CSV import is only available for standard CRM objects.");
        const response = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}preview=true`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Import validation failed.");
        setPendingImport({ csv: text, count: result.count });
        return;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error("The selected JSON file is not valid JSON."); }
      const rows = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && "records" in parsed ? (parsed as { records: unknown }).records : null;
      if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error("Choose a file containing between 1 and 500 records.");
      if (native) {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: rows, preview: true }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Import validation failed.");
        setPendingImport({ records: rows as Record<string, unknown>[], count: rows.length });
      } else {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed.");
      await load();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  }
  async function commitImport() {
    if (!pendingImport) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": pendingImport.csv ? "text/csv" : "application/json" },
        body: pendingImport.csv ?? JSON.stringify({ records: pendingImport.records }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setPendingImport(null);
      await load();
      setError(`${result.count} records imported successfully.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
    finally { setBusy(false); }
  }
  async function loadShares(record: RecordRow) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/crm-records/${objectId}/shares?recordId=${encodeURIComponent(record.id)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load record shares.");
      setSharingRecord(record);
      setRecordShares(result.shares);
      setShareUsers(result.users);
      setShareUserId("");
      setShareAccess("READ");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load record shares.");
    } finally {
      setBusy(false);
    }
  }
  async function saveShare() {
    if (!sharingRecord || !shareUserId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/crm-records/${objectId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: sharingRecord.id, userId: shareUserId, access: shareAccess }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not share record.");
      await loadShares(sharingRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not share record.");
    } finally {
      setBusy(false);
    }
  }
  async function removeShare(userId: string) {
    if (!sharingRecord) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/crm-records/${objectId}/shares`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: sharingRecord.id, userId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove record share.");
      setRecordShares((current) => current.filter((share) => share.userId !== userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove record share.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="crm-custom-records">
    <div className="crm-panel-heading"><div><h3>Records</h3><p>{payload.records.length} records · actions follow this object’s CRUD and field permissions.</p></div>
      <div className="crm-custom-record-actions">
        {!singleRecord && <button className="button button-quiet" onClick={native ? exportCsv : exportRecords} disabled={!payload.records.length}><Download size={15} /> Export {native ? "CSV" : "JSON"}</button>}
        {!singleRecord && payload.capabilities.canCreate && <button className="button button-quiet" onClick={() => upload.current?.click()} disabled={busy}><FileUp size={15} /> Import {native ? "CSV / JSON" : "JSON"}</button>}
        <input ref={upload} type="file" accept={native ? "application/json,.json,text/csv,.csv" : "application/json,.json"} hidden onChange={(event) => void importFile(event.target.files?.[0])} />
        {!singleRecord && payload.capabilities.canCreate && <button className="button button-secondary" onClick={startNew}><Plus size={15} /> New record</button>}
      </div>
    </div>
    {error && <p className="crm-setup-error" role="status">{error}</p>}
    {payload.truncated && <p className="crm-setup-error" role="status">Only the first 1,000 records are shown. Use export to retrieve up to 10,000 rows.</p>}
    {selected.length > 0 && <div className="crm-custom-selection"><span>{selected.length} selected</span>{payload.capabilities.canDelete && <button className="button button-danger" onClick={() => void deleteSelected()} disabled={busy}><Trash2 size={15} /> Delete selected</button>}</div>}
    <div className="crm-custom-record-table-wrap"><table className="crm-custom-record-table"><thead><tr><th><input type="checkbox" aria-label="Select all records" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? payload.records.map((row) => row.id) : [])} /></th>{layoutFields.map((field) => <th key={field.id}>{field.label}</th>)}<th>Updated</th></tr></thead>
      <tbody>{payload.records.map((row) => <tr key={row.id} onDoubleClick={() => payload.capabilities.canEdit && writable.length > 0 && startEdit(row)}><td><input type="checkbox" aria-label={`Select record ${display(row.data[primaryField || "Name"] ?? row.data.Name ?? row.data.Title ?? row.data.Reference)}`} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td>{layoutFields.map((field) => {
        const targetApiName = lookupTargets[field.apiName] || field.relationship?.targetApiName;
        const targetId = targetApiName ? payload.objectIds?.[targetApiName] : undefined;
        const relatedId = row.data[field.apiName];
        const lookupLabel = typeof relatedId === "string" ? payload.lookups?.[field.apiName]?.find((option) => option.id === relatedId)?.label : undefined;
        const value = display(lookupLabel || relatedId);
        return <td key={field.id}>{native && field.apiName === primaryField ? <Link className="table-primary" href={`/records/${objectId}/${row.id}`}>{value}</Link>
          : native && field.dataType === "LOOKUP" && targetId && typeof relatedId === "string" ? <Link href={`/records/${targetId}/${relatedId}`}>{value}</Link>
            : value}</td>;
      })}<td>{payload.capabilities.canEdit && fields.some((field) => field.canEdit) && <button className="button button-quiet" onClick={() => startEdit(row)}>Edit</button>} {payload.capabilities.canEdit && row.canManageShares && <button className="button button-quiet" onClick={() => void loadShares(row)}>Share</button>} {new Date(row.updatedAt).toLocaleDateString()}</td></tr>)}
      {!payload.records.length && <tr><td colSpan={fields.length + 2} className="crm-custom-empty">No records yet. Add one or import a JSON file.</td></tr>}</tbody>
    </table></div>
    {sharingRecord && <div className="dialog-backdrop"><section className="panel dialog crm-record-dialog" role="dialog" aria-modal="true" aria-label="Manage record shares">
      <div className="dialog-heading"><div><span className="eyebrow">{payload.object.name}</span><h2>Share record</h2></div><button className="icon-button" aria-label="Close" onClick={() => setSharingRecord(null)}><X size={17} /></button></div>
      <div className="form-grid">
        <label className="field"><span>Share with</span><select value={shareUserId} onChange={(event) => setShareUserId(event.target.value)}><option value="">Select a user…</option>{shareUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
        <label className="field"><span>Access</span><select value={shareAccess} onChange={(event) => setShareAccess(event.target.value as "READ" | "EDIT")}><option value="READ">Read only</option><option value="EDIT">Read and edit</option></select></label>
      </div>
      <div className="dialog-actions"><button className="button button-primary" onClick={() => void saveShare()} disabled={busy || !shareUserId}><Save size={15} /> Save share</button></div>
      <h3>Current shares</h3>
      {recordShares.length ? <div className="queue-list">{recordShares.map((share) => <div className="queue-item" key={share.id}><div className="queue-main"><strong>{share.user.name}</strong><small>{share.user.email} · {share.access === "READ" ? "Read only" : "Read and edit"}{share.user.active ? "" : " · inactive"}</small></div><button className="button button-quiet" onClick={() => void removeShare(share.userId)} disabled={busy}><Trash2 size={14} /> Remove</button></div>)}</div> : <p className="panel-empty-copy">This record has no manual shares.</p>}
      {error && <p className="crm-setup-error" role="status">{error}</p>}
    </section></div>}
    {(editing !== null || form && Object.keys(form).length > 0) && <div className="dialog-backdrop"><section className="panel dialog crm-record-dialog" role="dialog" aria-modal="true" aria-label={editing ? "Edit record" : "New record"}>
      <div className="dialog-heading"><div><span className="eyebrow">{payload.object.name}</span><h2>{editing ? "Edit record" : "New record"}</h2></div><button className="icon-button" aria-label="Close" onClick={closeForm}><X size={17} /></button></div>
      <div className="crm-record-layout">{formSections.map((section) => <fieldset className="crm-record-layout-section" key={section.id}><legend>{section.label}</legend><div className="crm-record-layout-columns" style={{ gridTemplateColumns: `repeat(${Math.min(section.columns.length, 3)}, minmax(0, 1fr))` }}>{section.columns.map((column, index) => <div className="crm-record-layout-column" key={`${section.id}-${index}`}>{column.map(renderRecordField)}</div>)}</div></fieldset>)}</div>
      {!editing && ["Quote", "Order"].includes(payload.object.apiName) && <div className="crm-native-lines">
        <h3>Line items</h3>
        {lineItems.map((item, index) => <div className="crm-native-line" key={index}>
          <label className="field"><span>Product</span><select required value={item.productId} onChange={(event) => setLineItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, productId: event.target.value } : line))}><option value="">Select…</option>{(payload.lookups?.ProductId || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label className="field"><span>Quantity</span><input required type="number" min="1" step="1" value={item.quantity} onChange={(event) => setLineItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: event.target.value } : line))} /></label>
          <label className="field"><span>Unit price</span><input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setLineItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, unitPrice: event.target.value } : line))} /></label>
          {payload.object.apiName === "Quote" && <label className="field"><span>Line discount</span><input type="number" min="0" step="0.01" value={item.discount} onChange={(event) => setLineItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, discount: event.target.value } : line))} /></label>}
          {lineItems.length > 1 && <button className="button button-quiet" onClick={() => setLineItems((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button>}
        </div>)}
        <button className="button button-quiet" onClick={() => setLineItems((current) => [...current, { productId: "", quantity: "1", unitPrice: "0", discount: "0" }])}><Plus size={15} /> Add line</button>
      </div>}
      {error && <p className="crm-setup-error">{error}</p>}<div className="dialog-actions"><button className="button button-quiet" onClick={closeForm}>Cancel</button><button className="button button-primary" onClick={() => void save()} disabled={busy}><Save size={15} /> Save record</button></div>
    </section></div>}
    {pendingImport && <div className="dialog-backdrop"><section className="panel dialog crm-record-dialog" role="dialog" aria-modal="true" aria-label="Confirm import">
      <div className="dialog-heading"><div><span className="eyebrow">{payload.object.name}</span><h2>Confirm import</h2></div><button className="icon-button" aria-label="Cancel import" onClick={() => setPendingImport(null)}><X size={17} /></button></div>
      <p>{pendingImport.count} records passed validation. Import will be committed together; if any row fails, none will be added.</p>
      <div className="dialog-actions"><button className="button button-quiet" onClick={() => setPendingImport(null)}>Cancel</button><button className="button button-primary" onClick={() => void commitImport()} disabled={busy}><FileUp size={15} /> Import records</button></div>
    </section></div>}
  </section>;
}
