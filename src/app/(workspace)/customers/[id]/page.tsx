import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { PageHeader, StatusBadge } from "@/components/app-shell";
import { dateTime, money } from "@/lib/format";
import { RecordForm } from "@/components/record-form";
import { TicketCreateForm } from "@/components/workflow-forms";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [accountRead, accountEdit, contactCreate, contactRead, caseCreate, caseRead, quoteRead, orderRead, leadRead, productRead] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
  ]);
  const canReadAccount = accountRead.allowed;
  let canEditAccount = accountEdit.allowed;
  const canCreateContact = contactCreate.allowed;
  let canReadContact = contactRead.allowed;
  const canCreateCase = caseCreate.allowed;
  let canReadCase = caseRead.allowed;
  let canReadQuote = quoteRead.allowed;
  let canReadOrder = orderRead.allowed;
  let canReadLead = leadRead.allowed;
  let canReadProducts = productRead.allowed;
  if (!canReadAccount) notFound();
  const [accountFields, contactFields, caseFields, quoteFields, orderFields, orderItemFields, leadFields, productFields, accountEditFields, addressReadFields, addressEditFields] = await Promise.all([
    evaluateNativeFieldAuthorizations(user, { Account: ["Name", "Type", "Phone", "Email", "TaxId"] }),
    canReadContact ? evaluateNativeFieldAuthorizations(user, { Contact: ["Name", "Title", "Phone", "Email", "Primary"] }) : Promise.resolve({ allowed: false as const }),
    canReadCase ? evaluateNativeFieldAuthorizations(user, { Case: ["CaseNumber", "Subject", "Status", "UnitId"] }) : Promise.resolve({ allowed: false as const }),
    canReadQuote ? evaluateNativeFieldAuthorizations(user, { Quote: ["Name", "Status", "Total"] }) : Promise.resolve({ allowed: false as const }),
    canReadOrder ? evaluateNativeFieldAuthorizations(user, { Order: ["Name", "Status", "Total"] }) : Promise.resolve({ allowed: false as const }),
    canReadOrder ? evaluateNativeFieldAuthorizations(user, { OrderItem: ["SKU", "Quantity"] }) : Promise.resolve({ allowed: false as const }),
    canReadLead ? evaluateNativeFieldAuthorizations(user, { Lead: ["Name", "Reference", "Interest", "Status", "Notes", "ActivityKind", "ActivityNote"] }) : Promise.resolve({ allowed: false as const }),
    canReadProducts ? evaluateNativeFieldAuthorizations(user, { Product: ["Name", "ProductCode"] }) : Promise.resolve({ allowed: false as const }),
    canEditAccount ? evaluateNativeFieldAuthorizations(user, { Account: ["Name", "Type", "Phone", "Email", "TaxId", "Notes"] }, "edit") : Promise.resolve({ allowed: false as const }),
    canReadAccount ? evaluateNativeFieldAuthorizations(user, { Account: ["AddressDetails"] }) : Promise.resolve({ allowed: false as const }),
    canEditAccount ? evaluateNativeFieldAuthorizations(user, { Account: ["AddressDetails"] }, "edit") : Promise.resolve({ allowed: false as const }),
  ]);
  if (!accountFields.allowed) notFound();
  canEditAccount = canEditAccount && accountEditFields.allowed;
  canReadContact = canReadContact && contactFields.allowed;
  canReadCase = canReadCase && caseFields.allowed;
  canReadQuote = canReadQuote && quoteFields.allowed;
  canReadOrder = canReadOrder && orderFields.allowed;
  const canReadOrderItems = canReadOrder && orderItemFields.allowed;
  canReadLead = canReadLead && leadFields.allowed;
  canReadProducts = canReadProducts && productFields.allowed;
  const canReadAddresses = addressReadFields.allowed;
  const canEditAddresses = canEditAccount && addressEditFields.allowed;
  const { id } = await params;
  const [accountRecord, contactIds, caseIds, quoteIds, orderIds, leadIds, productIds] = await Promise.all([
    getNativeCrmRecord("Account", id, user),
    canReadContact ? listNativeCrmRecordIds("Contact", user) : Promise.resolve([]),
    canReadCase ? listNativeCrmRecordIds("Case", user) : Promise.resolve([]),
    canReadQuote ? listNativeCrmRecordIds("Quote", user) : Promise.resolve([]),
    canReadOrder ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    canReadLead ? listNativeCrmRecordIds("Lead", user) : Promise.resolve([]),
    canReadProducts ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
  ]);
  if (!accountRecord) notFound();
  const customer = await prisma.customer.findFirst({
    where: { id },
    include: {
      contacts: { where: { id: { in: contactIds } } }, addresses: canReadAddresses,
      quotes: { where: { id: { in: quoteIds } }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 10 },
      orders: { where: { id: { in: orderIds } }, include: { items: { include: { shipments: true } }, shipments: true }, orderBy: { createdAt: "desc" }, take: 10 },
      units: { where: { productId: { in: productIds } }, include: { product: true, replacement: true, replacedUnit: true }, orderBy: { createdAt: "desc" } },
      tickets: { where: { id: { in: caseIds } }, include: { unit: true, updates: { orderBy: { createdAt: "desc" }, take: 3 } }, orderBy: { createdAt: "desc" }, take: 10 },
      leads: { where: { id: { in: leadIds } }, include: { activities: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { updatedAt: "desc" }, take: 10 },
    },
  });
  if (!customer) notFound();
  return <>
    <div className="breadcrumb"><Link href="/customers">Customers</Link> / {customer.name}</div>
    <PageHeader eyebrow="CUSTOMER RECORD" title={customer.name} description={`${customer.kind === "BUSINESS" ? "Business" : "Individual"} · Added ${dateTime(customer.createdAt)}`}
      action={<div className="header-form-actions">
        {canCreateCase && <TicketCreateForm customers={[{ id: customer.id, label: customer.name }]} units={customer.units.map((unit) => ({ id: unit.id, customerId: customer.id, label: `${unit.product.sku} · ${unit.product.name} · ${unit.serial}` }))} orders={customer.orders.map((order) => ({ id: order.id, customerId: customer.id, label: order.reference }))} />}
        {canEditAccount && <RecordForm title="Edit customer" endpoint={`/api/customers/${id}`} method="PATCH" submitLabel="Save customer" fields={[
          { name: "name", label: "Customer name", required: true, defaultValue: customer.name },
          { name: "kind", label: "Customer type", type: "select", required: true, defaultValue: customer.kind, options: [{ label: "Business", value: "BUSINESS" }, { label: "Individual", value: "INDIVIDUAL" }] },
          { name: "phone", label: "Phone", type: "tel", defaultValue: customer.phone || "" }, { name: "email", label: "Email", type: "email", defaultValue: customer.email || "" },
          { name: "taxId", label: "Tax ID", defaultValue: customer.taxId || "" }, { name: "notes", label: "Notes", type: "textarea", defaultValue: customer.notes || "" },
        ]} />}
        {canCreateContact && <>
        <RecordForm title="Add contact" endpoint={`/api/customers/${id}/contacts`} fields={[
          { name: "firstName", label: "First name" }, { name: "lastName", label: "Last name", required: true },
          { name: "title", label: "Job title" },
          { name: "phone", label: "Phone", type: "tel" }, { name: "email", label: "Email", type: "email" },
          { name: "primary", label: "Primary contact", type: "select", defaultValue: "false", options: [{ label: "No", value: "false" }, { label: "Yes", value: "true" }] },
        ]} />
        </>}
        {canEditAddresses && <>
        <RecordForm title="Add address" endpoint={`/api/customers/${id}/addresses`} fields={[
          { name: "label", label: "Address type", type: "select", required: true, options: ["Billing", "Shipping", "Other"].map((item) => ({ label: item, value: item })) },
          { name: "line1", label: "Address line 1", required: true }, { name: "line2", label: "Address line 2" },
          { name: "city", label: "City", required: true }, { name: "state", label: "State", required: true },
          { name: "postalCode", label: "Postal code", required: true }, { name: "country", label: "Country", required: true, defaultValue: "India" },
        ]} />
        </>}
      </div>}
    />
    <div className="detail-grid">
      <div className="detail-card"><small>Primary phone</small><strong>{customer.phone || "—"}</strong></div>
      <div className="detail-card"><small>Email</small><strong>{customer.email || "—"}</strong></div>
      <div className="detail-card"><small>Tax ID</small><strong>{customer.taxId || "—"}</strong></div>
    </div>
    <div className="panel section-spacer">
      <div className="panel-header"><div><h2>Contacts & addresses</h2><p>Billing and delivery details on file</p></div></div>
      <div className="customer-contact-list">
        {(customer.contacts.length || (canReadAddresses && customer.addresses.length)) ? <>
          {customer.contacts.map((contact) => <div className="queue-item" key={contact.id}><div className="queue-main"><strong><Link href={`/contacts/${contact.id}`} className="record-link">{contact.name}{contact.primary ? " · Primary" : ""}</Link></strong><small>{contact.title || "Contact"} · {contact.phone || contact.email || "No contact details"}</small></div></div>)}
          {canReadAddresses && customer.addresses.map((address) => <div className="queue-item" key={address.id}><div className="queue-main"><strong>{address.label}</strong><small>{[address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", ")}</small></div></div>)}
        </> : <p className="panel-empty-copy">No additional contacts or addresses have been recorded.</p>}
      </div>
    </div>
    {canReadQuote && <div className="panel section-spacer"><div className="panel-header"><div><h2>Quotes</h2><p>Recent quotations for this customer</p></div><Link className="text-link" href="/quotes">All quotes</Link></div>
      {customer.quotes.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>{customer.quotes.map((quote) => <tr key={quote.id}><td><Link className="table-primary" href={`/quotes/${quote.id}`}>{quote.reference}</Link></td><td>{dateTime(quote.createdAt)}</td><td>{quote.items.length}</td><td>{money(quote.total)}</td><td><StatusBadge>{quote.status}</StatusBadge></td></tr>)}</tbody></table></div> : <p className="panel-empty-copy">No quotes yet.</p>}
    </div>}
    {canReadOrder && <div className="panel section-spacer"><div className="panel-header"><div><h2>Orders & delivery history</h2><p>Shipment and delivered quantities</p></div></div>
      {customer.orders.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Shipment records</th><th>Status</th></tr></thead><tbody>{customer.orders.map((order) => <tr key={order.id}><td><Link className="table-primary" href={`/orders/${order.id}`}>{order.reference}</Link><span className="table-sub">{dateTime(order.createdAt)}</span></td><td>{canReadOrderItems ? order.items.map((item) => `${item.skuSnapshot} × ${item.quantity}`).join(", ") : "Restricted"}</td><td>{money(order.total)}</td><td>{order.shipments.length}</td><td><StatusBadge>{order.status}</StatusBadge></td></tr>)}</tbody></table></div> : <p className="panel-empty-copy">No orders yet.</p>}
    </div>}
    <div className="panel section-spacer"><div className="panel-header"><div><h2>Purchased products</h2><p>Serials, warranty, and replacements</p></div></div>
      {customer.units.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Serial</th><th>Warranty</th><th>Replacement history</th></tr></thead><tbody>{customer.units.map((unit) => <tr key={unit.id}><td><strong>{unit.product.name}</strong><span className="table-sub">{unit.product.sku}</span></td><td>{unit.serial}</td><td>{unit.warrantyEnd ? dateTime(unit.warrantyEnd) : "No warranty on file"}</td><td>{unit.replacement ? `Replaced by ${unit.replacement.serial}` : unit.replacedUnit ? `Replacement for ${unit.replacedUnit.serial}` : "—"}</td></tr>)}</tbody></table></div> : <p className="panel-empty-copy">No serialized product history yet.</p>}
    </div>
    {canReadCase && <div className="panel section-spacer"><div className="panel-header"><div><h2>Service tickets</h2><p>Support history and current work</p></div><Link className="text-link" href="/service">Service queue</Link></div>
      {customer.tickets.length ? <div className="queue-list">{customer.tickets.map((ticket) => <div className="queue-item" key={ticket.id}><div className="queue-main"><strong><Link href={`/service/${ticket.id}`} className="record-link">{ticket.reference} · {ticket.title}</Link></strong><small>{ticket.unit ? `Serial ${ticket.unit.serial}` : "No purchased unit linked"} · {dateTime(ticket.createdAt)}</small></div><StatusBadge>{ticket.status}</StatusBadge></div>)}</div> : <p className="panel-empty-copy">No tickets yet.</p>}
    </div>}
    {canReadLead && <div className="panel section-spacer"><div className="panel-header"><div><h2>Lead activity</h2><p>Enquiries associated with this customer</p></div></div>
      {customer.leads.length ? <div className="queue-list">{customer.leads.map((lead) => <div className="queue-item" key={lead.id}><div className="queue-main"><strong><Link href={`/leads/${lead.id}`} className="record-link">{lead.reference} · {lead.interest || lead.name}</Link></strong><small>{lead.activities.length ? `${lead.activities[0].kind}: ${lead.activities[0].note}` : "No activity logged"}</small></div><StatusBadge>{lead.status}</StatusBadge></div>)}</div> : <p className="panel-empty-copy">No leads linked.</p>}
    </div>}
  </>;
}
