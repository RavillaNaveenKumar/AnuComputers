import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorization, evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime, money } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/app-shell";
import { PrintQuoteButton, QuoteControls } from "@/components/workflow-forms";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [readAuthorization, editAuthorization, orderAuthorization, orderCreateAuthorization, accountAuthorization, quoteLineItemAuthorization, opportunityAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "QuoteLineItem", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Opportunity", objectCapability: "canRead" }),
  ]);
  const canReadQuote = readAuthorization.allowed;
  let canEditQuote = editAuthorization.allowed;
  let canReadOrder = orderAuthorization.allowed;
  const canCreateOrder = orderCreateAuthorization.allowed;
  const canReadAccount = accountAuthorization.allowed;
  const opportunityLinkFieldAuthorization = opportunityAuthorization.allowed
    ? await evaluateNativeFieldAuthorization(user, "Quote", ["OpportunityId"], "read")
    : null;
  const canReadOpportunity = opportunityAuthorization.allowed && Boolean(opportunityLinkFieldAuthorization?.allowed);
  if (!canReadQuote) notFound();
  const [fieldAuthorization, quoteLineItemFields, accountFields, orderFields, editFields] = await Promise.all([
    evaluateNativeFieldAuthorizations(user, {
      Quote: ["Name", "AccountId", "Status", "Subtotal", "Discount", "Total", "ValidUntil"],
    }),
    quoteLineItemAuthorization.allowed
      ? evaluateNativeFieldAuthorizations(user, {
        QuoteLineItem: ["QuoteId", "ProductId", "SKU", "Description", "Quantity", "UnitPrice", "Discount"],
      })
      : Promise.resolve({ allowed: false as const }),
    canReadAccount ? evaluateNativeFieldAuthorizations(user, { Account: ["Name", "Email", "Phone"] }) : Promise.resolve({ allowed: false as const }),
    canReadOrder ? evaluateNativeFieldAuthorizations(user, { Order: ["Name"] }) : Promise.resolve({ allowed: false as const }),
    canEditQuote ? evaluateNativeFieldAuthorizations(user, { Quote: ["Status"] }, "edit") : Promise.resolve({ allowed: false as const }),
  ]);
  if (!fieldAuthorization.allowed) notFound();
  const canReadQuoteLines = quoteLineItemAuthorization.allowed && quoteLineItemFields.allowed;
  const canDisplayAccount = canReadAccount && accountFields.allowed;
  canReadOrder = canReadOrder && orderFields.allowed;
  canEditQuote = canEditQuote && editFields.allowed;
  const { id } = await params;
  const quoteRecord = await getNativeCrmRecord("Quote", id, user);
  if (!quoteRecord || (canDisplayAccount && !await getNativeCrmRecord("Account", String(quoteRecord.data.AccountId), user))) notFound();
  const [quote, accessibleOrderIds, quoteObject, opportunityObject] = await Promise.all([
    prisma.quote.findFirst({ where: { id }, include: { customer: canDisplayAccount ? { select: { name: true, email: true, phone: true } } : false, items: canReadQuoteLines, createdBy: { select: { name: true } } } }),
    canReadOrder ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    prisma.crmObject.findFirst({ where: { apiName: "Quote" }, select: { id: true } }),
    canReadOpportunity ? prisma.crmObject.findFirst({ where: { apiName: "Opportunity" }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!quote) notFound();
  const opportunityField = quoteObject && canReadOpportunity
    ? await prisma.crmField.findFirst({ where: { objectId: quoteObject.id, apiName: "OpportunityId", active: true }, select: { id: true } })
    : null;
  const opportunityFieldValue = opportunityField
    ? await prisma.crmNativeFieldValue.findUnique({ where: { objectApiName_recordId_fieldId: { objectApiName: "Quote", recordId: id, fieldId: opportunityField.id } }, select: { value: true } })
    : null;
  const opportunityId = typeof opportunityFieldValue?.value === "string" ? opportunityFieldValue.value : null;
  const linkedOpportunity = opportunityId && canReadOpportunity ? await getNativeCrmRecord("Opportunity", opportunityId, user) : null;
  const relatedOrder = canReadOrder
    ? await prisma.order.findFirst({ where: { quoteId: id, id: { in: accessibleOrderIds } }, select: { id: true, reference: true } })
    : null;
  return <>
    <div className="breadcrumb print-hidden"><Link href="/quotes">Quotations</Link> / {quote.reference}</div>
    <PageHeader eyebrow="QUOTATION" title={quote.reference} description={`Prepared for ${canDisplayAccount ? quote.customer?.name || "Restricted account" : "Restricted account"} · ${dateTime(quote.createdAt)}`} action={<><StatusBadge>{quote.status}</StatusBadge><span className="print-hidden"><PrintQuoteButton /></span></>} />
    <section className="panel quote-sheet">
      <div className="quote-company"><span className="brand-mark">A</span><div><strong>Anu Computers</strong><small>Computer systems, parts & service</small></div><div className="quote-meta"><small>Quotation</small><strong>{quote.reference}</strong><small>Prepared by {quote.createdBy.name}</small></div></div>
      <div className="quote-billto"><div><small>PREPARED FOR</small><strong>{canDisplayAccount ? quote.customer?.name || "Restricted" : "Restricted"}</strong>{canDisplayAccount && quote.customer && <><span>{quote.customer.email || ""}</span><span>{quote.customer.phone || ""}</span></>}</div><div><small>VALID UNTIL</small><strong>{quote.validUntil ? dateTime(quote.validUntil) : "As agreed"}</strong></div></div>
      {opportunityId && <div className="quote-order-link">Opportunity: {linkedOpportunity && opportunityObject ? <Link href={`/records/${opportunityObject.id}/${opportunityId}`} className="record-link">{String(linkedOpportunity.data.Name || "Opportunity")}</Link> : "Restricted opportunity"}</div>}
      {canReadQuoteLines ? <div className="table-wrap"><table className="data-table"><thead><tr><th>SKU</th><th>Description</th><th className="numeric">Qty</th><th className="numeric">Unit price</th><th className="numeric">Discount</th><th className="numeric">Line total</th></tr></thead><tbody>
        {quote.items.map((item) => <tr key={item.id}><td>{item.skuSnapshot}</td><td>{item.description}</td><td className="numeric">{item.quantity}</td><td className="numeric">{money(item.unitPrice)}</td><td className="numeric">{money(item.discount)}</td><td className="numeric">{money(Number(item.unitPrice) * item.quantity - Number(item.discount))}</td></tr>)}
      </tbody></table></div> : <p className="panel-empty-copy">Quotation line items are restricted.</p>}
      <div className="quote-totals"><div><span>Subtotal</span><strong>{money(quote.subtotal)}</strong></div><div><span>Discount</span><strong>− {money(quote.discount)}</strong></div><div className="quote-grand-total"><span>Total (INR)</span><strong>{money(quote.total)}</strong></div></div>
      {relatedOrder && <div className="quote-order-link">Order created: <Link href={`/orders/${relatedOrder.id}`} className="record-link">{relatedOrder.reference}</Link></div>}
      {quote.status !== "REJECTED" && quote.status !== "EXPIRED" && ((quote.status === "ACCEPTED" && canCreateOrder && !relatedOrder) || (quote.status !== "ACCEPTED" && canEditQuote)) && <div className="quote-actions print-hidden"><QuoteControls id={quote.id} status={quote.status} canEditQuote={canEditQuote} canCreateOrder={canCreateOrder && !relatedOrder} /></div>}
      <p className="quote-terms">Prices are quoted in INR. Accounting and GST filing are managed outside this CRM.</p>
    </section>
  </>;
}
