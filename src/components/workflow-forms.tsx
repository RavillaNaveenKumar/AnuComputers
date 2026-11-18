"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, PackagePlus, Printer } from "lucide-react";

type Option = { id: string; label: string };
type OpportunityOption = Option & { customerId: string };
type ProductOption = Option & { price: string };

function usePost() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function send(endpoint: string, method: "POST" | "PATCH", body: unknown) {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Review the details and try again.");
        return null;
      }
      router.refresh();
      return result;
    } catch {
      setError("Request could not be completed. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, send };
}

export function QuoteCreateForm({ customers, products, opportunities = [] }: { customers: Option[]; products: ProductOption[]; opportunities?: OpportunityOption[] }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [lines, setLines] = useState([{ productId: "", quantity: "1", unitPrice: "", itemDiscount: "0" }]);
  const [discount, setDiscount] = useState("0");
  const [validUntil, setValidUntil] = useState("");
  const { error, busy, send } = usePost();

  function updateLine(index: number, patch: Partial<(typeof lines)[number]>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }
  function chooseProduct(index: number, value: string) {
    updateLine(index, { productId: value, unitPrice: products.find((product) => product.id === value)?.price || "" });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await send("/api/quotes", "POST", {
      customerId,
      ...(opportunityId ? { opportunityId } : {}),
      discount: Number(discount),
      ...(validUntil ? { validUntil: new Date(`${validUntil}T23:59:59`).toISOString() } : {}),
      items: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), discount: Number(line.itemDiscount) })),
    });
    if (result) {
      setOpen(false);
      setLines([{ productId: "", quantity: "1", unitPrice: "", itemDiscount: "0" }]);
      setDiscount("0");
      setValidUntil("");
      setOpportunityId("");
    }
  }
  return <>
    <button className="button button-primary" onClick={() => setOpen(true)}><PackagePlus size={16} /> New quote</button>
    {open && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="quote-dialog-title">
      <div className="dialog-header"><div><div className="eyebrow">SALES</div><h2 id="quote-dialog-title">Create quotation</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={submit}><div className="form-grid">
        <label className="field field-full"><span>Customer *</span><select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Select customer…</option>{customers.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
        {opportunities.length > 0 && <label className="field field-full"><span>Related opportunity (optional)</span><select value={opportunityId} onChange={(event) => { const selected = opportunities.find((option) => option.id === event.target.value); setOpportunityId(event.target.value); if (selected) setCustomerId(selected.customerId); }}><option value="">No opportunity</option>{opportunities.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>}
        {lines.map((line, index) => <div className="quote-line-editor field-full" key={index}><div className="quote-line-heading"><strong>Item {index + 1}</strong>{lines.length > 1 && <button type="button" className="text-button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button>}</div>
          <div className="form-grid">
            <label className="field field-full"><span>Product *</span><select required value={line.productId} onChange={(event) => chooseProduct(index, event.target.value)}><option value="">Select product…</option>{products.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            <label className="field"><span>Quantity *</span><input type="number" min="1" required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
            <label className="field"><span>Unit price (INR) *</span><input type="number" min="0" step="0.01" required value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label>
            <label className="field"><span>Line discount (INR)</span><input type="number" min="0" step="0.01" value={line.itemDiscount} onChange={(event) => updateLine(index, { itemDiscount: event.target.value })} /></label>
          </div>
        </div>)}
        <button type="button" className="button button-small button-outline field-full" onClick={() => setLines((current) => [...current, { productId: "", quantity: "1", unitPrice: "", itemDiscount: "0" }])}>Add another item</button>
        <label className="field"><span>Quote discount (INR)</span><input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
        <label className="field"><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="dialog-footer"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create quote"}</button></div>
      </form>
    </section></div>}
  </>;
}

export function DirectOrderForm({ customers, products }: { customers: Option[]; products: ProductOption[] }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [invoiceReference, setInvoiceReference] = useState("");
  const { error, busy, send } = usePost();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await send("/api/orders/direct", "POST", {
      customerId, invoiceReference,
      items: [{ productId, quantity: Number(quantity), unitPrice: Number(unitPrice) }],
    });
    if (result) setOpen(false);
  }
  function chooseProduct(value: string) {
    setProductId(value);
    setUnitPrice(products.find((item) => item.id === value)?.price || "");
  }
  return <>
    <button className="button button-outline" onClick={() => setOpen(true)}>Direct order</button>
    {open && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="direct-order-title">
      <div className="dialog-header"><div><div className="eyebrow">REPEAT CUSTOMER</div><h2 id="direct-order-title">Create direct order</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={submit}><div className="form-grid">
        <label className="field field-full"><span>Customer *</span><select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Select customer…</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="field field-full"><span>Product *</span><select required value={productId} onChange={(event) => chooseProduct(event.target.value)}><option value="">Select product…</option>{products.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="field"><span>Quantity *</span><input type="number" min="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label className="field"><span>Unit price (INR) *</span><input type="number" min="0" step="0.01" required value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></label>
        <label className="field field-full"><span>Invoice reference (optional)</span><input value={invoiceReference} onChange={(event) => setInvoiceReference(event.target.value)} /></label>
      </div>{error && <div className="form-error">{error}</div>}<div className="dialog-footer"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create order"}</button></div></form>
    </section></div>}
  </>;
}

export function QuoteControls({ id, status }: { id: string; status: string }) {
  const { error, busy, send } = usePost();
  const canSend = status === "DRAFT";
  const canAccept = status === "SENT";
  const canOrder = status === "ACCEPTED";
  return <div className="workflow-controls">
    {canSend && <button className="button button-small button-outline" disabled={busy} onClick={() => send(`/api/quotes/${id}`, "PATCH", { status: "SENT" })}>Mark sent</button>}
    {canAccept && <button className="button button-small button-outline" disabled={busy} onClick={() => send(`/api/quotes/${id}`, "PATCH", { status: "ACCEPTED" })}>Accept quote</button>}
    {canOrder && <button className="button button-small button-primary" disabled={busy} onClick={() => send(`/api/quotes/${id}`, "POST", { action: "create-order" })}><Check size={14} /> Create order</button>}
    {error && <small className="inline-error">{error}</small>}
  </div>;
}

export function PrintQuoteButton() {
  return <button className="button button-outline" onClick={() => window.print()}><Printer size={15} /> Print</button>;
}

export function ShipmentForm({ orderId, items }: { orderId: string; items: { id: string; label: string; pending: number }[] }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [quantity, setQuantity] = useState("1");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const { error, busy, send } = usePost();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await send(`/api/orders/${orderId}/shipments`, "POST", { carrier, tracking, items: [{ orderItemId: itemId, quantity: Number(quantity) }] });
    if (result) setOpen(false);
  }
  if (!items.length) return null;
  return <>
    <button className="button button-small button-outline" onClick={() => setOpen(true)}><PackagePlus size={14} /> Create shipment</button>
    {open && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby={`shipment-${orderId}`}>
      <div className="dialog-header"><div><div className="eyebrow">DISPATCH</div><h2 id={`shipment-${orderId}`}>Create shipment</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={submit}><div className="form-grid">
        <label className="field field-full"><span>Order line *</span><select value={itemId} onChange={(event) => setItemId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.pending} pending</option>)}</select></label>
        <label className="field"><span>Quantity *</span><input type="number" min="1" max={items.find((item) => item.id === itemId)?.pending || 1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label className="field"><span>Carrier</span><input value={carrier} onChange={(event) => setCarrier(event.target.value)} /></label>
        <label className="field field-full"><span>Tracking reference</span><input value={tracking} onChange={(event) => setTracking(event.target.value)} /></label>
      </div>{error && <div className="form-error">{error}</div>}<div className="dialog-footer"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create shipment"}</button></div></form>
    </section></div>}
  </>;
}

export function DeliveryForm({ shipmentId, items }: { shipmentId: string; items: { id: string; label: string; remaining: number; serialTracked: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [quantity, setQuantity] = useState("1");
  const [serialText, setSerialText] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const { error, busy, send } = usePost();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const line = items.find((item) => item.id === itemId);
    if (!line) return;
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    const result = await send(`/api/shipments/${shipmentId}/deliver`, "POST", {
      idempotencyKey: requestKey,
      items: [{ shipmentItemId: itemId, quantity: Number(quantity), serials: line.serialTracked ? serialText.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean) : [] }],
    });
    if (result) { setOpen(false); setIdempotencyKey(""); }
  }
  if (!items.length) return null;
  return <>
    <button className="button button-small button-outline" onClick={() => setOpen(true)}>Confirm delivery</button>
    {open && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby={`delivery-${shipmentId}`}>
      <div className="dialog-header"><div><div className="eyebrow">DELIVERY</div><h2 id={`delivery-${shipmentId}`}>Confirm received quantity</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={submit}><div className="form-grid">
        <label className="field field-full"><span>Shipment line *</span><select value={itemId} onChange={(event) => setItemId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.remaining} remaining</option>)}</select></label>
        <label className="field"><span>Delivered now *</span><input type="number" min="1" max={items.find((item) => item.id === itemId)?.remaining || 1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        {items.find((item) => item.id === itemId)?.serialTracked && <label className="field field-full"><span>Serial numbers (one per line or comma-separated)</span><textarea rows={4} value={serialText} onChange={(event) => setSerialText(event.target.value)} placeholder="Enter one serial per delivered unit" /></label>}
      </div><p className="form-hint">Submitting creates an idempotency key for this delivery confirmation. Retain the same key if retrying via the API.</p>
      {error && <div role="alert" className="form-error">{error}</div>}<div className="dialog-footer"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Confirm delivery"}</button></div></form>
    </section></div>}
  </>;
}

export function TicketCreateForm({ customers, units, orders = [] }: {
  customers: Option[];
  units: { id: string; label: string; customerId: string }[];
  orders?: { id: string; label: string; customerId: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [orderId, setOrderId] = useState("");
  const { error, busy, send } = usePost();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await send("/api/tickets", "POST", {
      customerId,
      ...(unitId ? { unitId } : {}),
      ...(orderId ? { orderId } : {}),
      type: String(form.get("type")),
      title: String(form.get("title")),
      description: String(form.get("description")),
      priority: String(form.get("priority")),
    });
    if (result) setOpen(false);
  }
  return <>
    <button className="button button-primary" onClick={() => setOpen(true)}><PackagePlus size={16} /> New ticket</button>
    {open && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-form-title">
      <div className="dialog-header"><div><div className="eyebrow">CUSTOMER SERVICE</div><h2 id="ticket-form-title">Open service ticket</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={submit}><div className="form-grid">
        <label className="field field-full"><span>Customer *</span><select required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setUnitId(""); }}><option value="">Select customer…</option>{customers.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
        <label className="field field-full"><span>Purchased unit (optional)</span><select value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="">No purchased unit / walk-in repair</option>{units.filter((unit) => unit.customerId === customerId).map((unit) => <option value={unit.id} key={unit.id}>{unit.label}</option>)}</select></label>
        <label className="field field-full"><span>Related order (optional)</span><select value={orderId} onChange={(event) => setOrderId(event.target.value)}><option value="">No order linked</option>{orders.filter((order) => order.customerId === customerId).map((order) => <option value={order.id} key={order.id}>{order.label}</option>)}</select></label>
        <label className="field"><span>Issue type *</span><select name="type" required>{["TECHNICAL", "DELIVERY", "WARRANTY", "REPAIR", "REPLACEMENT"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Priority *</span><select name="priority" required>{["LOW", "NORMAL", "HIGH", "URGENT"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field field-full"><span>Subject *</span><input name="title" required maxLength={160} /></label>
        <label className="field field-full"><span>Issue details *</span><textarea name="description" rows={4} required /></label>
      </div>{error && <div role="alert" className="form-error">{error}</div>}<div className="dialog-footer"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Opening…" : "Open ticket"}</button></div></form>
    </section></div>}
  </>;
}

export function LeadActivityForm({ leadId }: { leadId: string }) {
  const { error, busy, send } = usePost();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("CALL");
  const [status, setStatus] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await send(`/api/leads/${leadId}/activities`, "POST", {
      kind,
      note,
      ...(status ? { status } : {}),
      ...(nextFollowUpAt ? { nextFollowUpAt: new Date(nextFollowUpAt).toISOString() } : {}),
    });
    if (result) { setNote(""); setStatus(""); setNextFollowUpAt(""); }
  }
  return <form className="inline-form" onSubmit={submit}>
    <div className="form-grid">
      <label className="field"><span>Activity type</span><select value={kind} onChange={(event) => setKind(event.target.value)}>{["CALL", "EMAIL", "MEETING", "NOTE", "FOLLOW_UP"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="field"><span>Update status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Keep current</option>{["NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="field"><span>Next follow-up</span><input type="datetime-local" value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} /></label>
      <label className="field field-full"><span>Notes *</span><textarea required rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="dialog-footer"><button className="button button-primary" disabled={busy}>{busy ? "Logging…" : "Log activity"}</button></div>
  </form>;
}

export function TicketUpdateForm({ ticketId, currentStatus, assignees = [] }: { ticketId: string; currentStatus: string; assignees?: Option[] }) {
  const { error, busy, send } = usePost();
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [waitingReason, setWaitingReason] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [partsUsedNotes, setPartsUsedNotes] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [warrantyDecision, setWarrantyDecision] = useState("");
  const [chargeable, setChargeable] = useState("");
  const [customerApproved, setCustomerApproved] = useState("");
  const [handoverNotes, setHandoverNotes] = useState("");
  const transitions: Record<string, string[]> = {
    NEW: ["ASSIGNED"],
    ASSIGNED: ["IN_PROGRESS", "WAITING"],
    IN_PROGRESS: ["WAITING", "RESOLVED"],
    WAITING: ["IN_PROGRESS", "RESOLVED"],
    RESOLVED: ["IN_PROGRESS", "CLOSED"],
    CLOSED: [],
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await send(`/api/tickets/${ticketId}`, "PATCH", {
      ...(status ? { status } : {}),
      ...(resolutionNote ? { resolutionNote } : {}),
      ...(waitingReason ? { waitingReason } : {}),
      ...(note ? { note } : {}),
      ...(diagnosis ? { diagnosis } : {}),
      ...(partsUsedNotes ? { partsUsedNotes } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(warrantyDecision ? { warrantyDecision } : {}),
      ...(chargeable ? { chargeable: chargeable === "true" } : {}),
      ...(customerApproved ? { customerApproved: customerApproved === "true" } : {}),
      ...(handoverNotes ? { handoverNotes } : {}),
    });
    if (result) { setStatus(""); setNote(""); setDiagnosis(""); setPartsUsedNotes(""); setAssigneeId(""); setWarrantyDecision(""); setChargeable(""); setCustomerApproved(""); setHandoverNotes(""); }
  }
  return <form className="inline-form" onSubmit={submit}><div className="form-grid">
    <label className="field"><span>Update status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Keep current ({currentStatus.replaceAll("_", " ")})</option>{(transitions[currentStatus] || []).map((value) => <option key={value}>{value}</option>)}</select></label>
    {assignees.length > 0 && <label className="field"><span>Assign technician / agent</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Keep current</option>{assignees.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>}
    <label className="field"><span>Warranty coverage decision</span><select value={warrantyDecision} onChange={(event) => setWarrantyDecision(event.target.value)}><option value="">Keep current</option>{["ACTIVE", "EXPIRED", "UNKNOWN", "APPROVED", "DECLINED"].map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="field"><span>Chargeable repair</span><select value={chargeable} onChange={(event) => setChargeable(event.target.value)}><option value="">Keep current</option><option value="true">Yes</option><option value="false">No</option></select></label>
    <label className="field"><span>Customer approval</span><select value={customerApproved} onChange={(event) => setCustomerApproved(event.target.value)}><option value="">Keep current</option><option value="true">Approved</option><option value="false">Not approved</option></select></label>
    <label className="field field-full"><span>Handover details</span><textarea rows={2} value={handoverNotes} onChange={(event) => setHandoverNotes(event.target.value)} /></label>
    <label className="field"><span>Waiting reason</span><input value={waitingReason} onChange={(event) => setWaitingReason(event.target.value)} /></label>
    <label className="field"><span>Diagnosis</span><input value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} /></label>
    <label className="field field-full"><span>Parts used</span><textarea rows={2} value={partsUsedNotes} onChange={(event) => setPartsUsedNotes(event.target.value)} /></label>
    <label className="field field-full"><span>Diagnosis / update note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {status === "RESOLVED" || status === "CLOSED" ? <label className="field field-full"><span>Resolution note {status === "CLOSED" ? "(required)" : ""}</span><textarea rows={3} required={status === "CLOSED"} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} /></label> : null}
  </div>
  {error && <div className="form-error">{error}</div>}
  <div className="dialog-footer"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save ticket update"}</button></div>
  </form>;
}

export function ReplacementForm({ ticketId, products }: { ticketId: string; products: ProductOption[] }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id || "");
  const [serial, setSerial] = useState("");
  const { error, busy, send } = usePost();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await send(`/api/tickets/${ticketId}/replace`, "POST", { productId, serial });
    if (result) setOpen(false);
  }
  return <>
    <button className="button button-outline" onClick={() => setOpen(true)}>Record replacement unit</button>
    {open && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-title">
      <div className="dialog-header"><div><div className="eyebrow">REPLACEMENT</div><h2 id="replacement-title">Register new unit</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={submit}><div className="form-grid"><label className="field field-full"><span>Replacement product *</span><select value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label className="field field-full"><span>New serial number *</span><input value={serial} required onChange={(event) => setSerial(event.target.value)} /></label></div>
      {error && <div className="form-error">{error}</div>}<div className="dialog-footer"><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save replacement"}</button></div></form>
    </section></div>}
  </>;
}
