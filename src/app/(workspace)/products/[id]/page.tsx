import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { EmptyState, PageHeader, StatusBadge } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { evaluateNativeFieldAuthorization, evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { money } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [productReadAuthorization, quoteReadAuthorization, orderReadAuthorization, accountReadAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
  ]);
  const canReadProduct = productReadAuthorization.allowed;
  let canReadQuoteData = quoteReadAuthorization.allowed;
  const canReadOrderData = orderReadAuthorization.allowed;
  let canReadAccounts = accountReadAuthorization.allowed;
  if (!canReadProduct) notFound();
  const productFieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Product: ["ProductCode", "Name", "Brand", "Model", "ManufacturerPart", "Description", "TrackingType", "WarrantyMonths", "Active", "CategoryId"],
  });
  if (!productFieldAuthorization.allowed) notFound();
  const priceFieldAuthorization = canReadQuoteData
    ? await evaluateNativeFieldAuthorization(user, "Product", ["Price"], "read")
    : null;
  if (priceFieldAuthorization && !priceFieldAuthorization.allowed) canReadQuoteData = false;
  const [quoteFieldAuthorization, orderFieldAuthorization, accountFieldAuthorization] = await Promise.all([
    canReadQuoteData ? evaluateNativeFieldAuthorizations(user, {
      Quote: ["Name"],
      QuoteLineItem: ["SKU", "Description", "Quantity", "UnitPrice"],
    }) : Promise.resolve({ allowed: true as const }),
    canReadOrderData ? evaluateNativeFieldAuthorizations(user, {
      Order: ["Name"],
      OrderItem: ["SKU", "Description", "Quantity"],
    }) : Promise.resolve({ allowed: true as const }),
    canReadAccounts ? evaluateNativeFieldAuthorizations(user, { Account: ["Name"] }) : Promise.resolve({ allowed: false as const }),
  ]);
  canReadQuoteData = canReadQuoteData && quoteFieldAuthorization.allowed;
  const canReadOrders = canReadOrderData && orderFieldAuthorization.allowed;
  canReadAccounts = canReadAccounts && accountFieldAuthorization.allowed;
  const { id } = await params;
  const productRecord = await getNativeCrmRecord("Product", id, user);
  if (!productRecord) notFound();
  const [quoteIds, orderIds, accountIds, quoteLineItemIds, orderItemIds] = await Promise.all([
    canReadQuoteData ? listNativeCrmRecordIds("Quote", user) : Promise.resolve([]),
    canReadOrders ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    canReadAccounts ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    canReadQuoteData ? listNativeCrmRecordIds("QuoteLineItem", user) : Promise.resolve([]),
    canReadOrders ? listNativeCrmRecordIds("OrderItem", user) : Promise.resolve([]),
  ]);
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { name: true } },
      quoteItems: { where: { id: { in: quoteLineItemIds }, quote: { id: { in: quoteIds } } }, include: { quote: { select: { id: true, reference: true, customer: { select: { name: true } } } } }, take: 50 },
      orderItems: { where: { id: { in: orderItemIds }, order: { id: { in: orderIds } } }, include: { order: { select: { id: true, reference: true, customer: { select: { name: true } } } } }, take: 50 },
      units: { where: { customerId: { in: accountIds } }, include: { customer: { select: { id: true, name: true } }, replacement: { select: { serial: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!product) notFound();
  const [editAuthorization, deleteAuthorization, warrantyDefault] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canDelete" }),
    prisma.businessSetting.findUnique({ where: { key: "defaultWarrantyMonths" }, select: { value: true } }),
  ]);
  const editFieldAuthorization = editAuthorization.allowed
    ? await evaluateNativeFieldAuthorizations(user, {
      Product: ["ProductCode", "Name", "Description", "Brand", "Model", "ManufacturerPart", "Price", "TrackingType", "WarrantyMonths", "Active", "CategoryId"],
    }, "edit")
    : null;
  const canEdit = editAuthorization.allowed && Boolean(editFieldAuthorization?.allowed);
  const canDelete = deleteAuthorization.allowed;
  const categories = canEdit ? await prisma.productCategory.findMany({ orderBy: { name: "asc" } }) : [];
  return <>
    <div className="breadcrumb"><Link href="/products">Products</Link> / {product.sku}</div>
    <PageHeader eyebrow="PRODUCT RECORD" title={product.name} description={`${product.sku}${product.brand ? ` · ${product.brand}` : ""}${product.model ? ` · ${product.model}` : ""}`}
      action={<div className="header-form-actions">
        <StatusBadge>{product.active ? "ACTIVE" : "INACTIVE"}</StatusBadge>
        {canEdit && <RecordForm title="Edit product" endpoint={`/api/products/${id}`} method="PATCH" submitLabel="Save product" fields={[
          { name: "sku", label: "SKU", required: true, defaultValue: product.sku },
          { name: "name", label: "Product name", required: true, defaultValue: product.name },
          { name: "description", label: "Description", type: "textarea", defaultValue: product.description || "" },
          { name: "brand", label: "Brand", defaultValue: product.brand || "" },
          { name: "model", label: "Model", defaultValue: product.model || "" },
          { name: "manufacturerPart", label: "Manufacturer part number", defaultValue: product.manufacturerPart || "" },
          { name: "unitPrice", label: "Unit price (INR)", type: "number", required: true, defaultValue: product.unitPrice.toString() },
          { name: "trackingType", label: "Tracking type", type: "select", required: true, defaultValue: product.trackingType, options: [{ label: "Serialized", value: "SERIAL" }, { label: "Quantity tracked", value: "QUANTITY" }] },
          { name: "warrantyMonths", label: "Warranty (months)", type: "number", defaultValue: String(product.warrantyMonths || warrantyDefault?.value || "0") },
          { name: "categoryId", label: "Category", type: "select", defaultValue: product.categoryId || "", options: [{ label: "No category", value: "" }, ...categories.map((category) => ({ label: category.name, value: category.id }))] },
          { name: "active", label: "Product status", type: "select", required: true, defaultValue: String(product.active), options: [{ label: "Active", value: "true" }, { label: "Inactive", value: "false" }] },
        ]} />}
        {canDelete && <DeleteRecordButton endpoint={`/api/products/${id}`} returnTo="/products" recordLabel={`product ${product.name}`} />}
      </div>}
    />
    <section className="detail-grid">
      {product.description && <div className="detail-card"><small>Description</small><span>{product.description}</span></div>}
      <div className="detail-card"><small>SKU / manufacturer part</small><strong>{product.sku}</strong><span>{product.manufacturerPart || "No manufacturer part number"}</span></div>
      <div className="detail-card"><small>Category</small><strong>{product.category?.name || "Uncategorized"}</strong></div>
      {canReadQuoteData && <div className="detail-card"><small>Unit price</small><strong>{money(product.unitPrice)}</strong></div>}
      <div className="detail-card"><small>Tracking / warranty</small><strong>{product.trackingType === "SERIAL" ? "Serial tracked" : "Quantity tracked"}</strong><span>{product.warrantyMonths ? `${product.warrantyMonths} months` : "No warranty"}</span></div>
    </section>
    {canReadQuoteData && <section className="panel section-spacer">
      <div className="panel-header"><div><h2>Quote history</h2><p>Quotes that include this product</p></div></div>
      {product.quoteItems.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Quote</th><th>Account</th><th>Description</th><th>Quantity</th><th>Unit price</th></tr></thead><tbody>
        {product.quoteItems.map((item) => <tr key={item.id}><td><Link className="table-primary" href={`/quotes/${item.quote.id}`}>{item.quote.reference}</Link></td><td>{canReadAccounts ? item.quote.customer.name : "Restricted"}</td><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td></tr>)}
      </tbody></table></div> : <EmptyState title="No quote history" description="This product has not been added to a quote." />}
    </section>}
    {canReadOrders && <section className="panel section-spacer">
      <div className="panel-header"><div><h2>Order history</h2><p>Orders that include this product</p></div></div>
      {product.orderItems.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Account</th><th>Description</th><th>Quantity</th></tr></thead><tbody>
        {product.orderItems.map((item) => <tr key={item.id}><td><Link className="table-primary" href={`/orders/${item.order.id}`}>{item.order.reference}</Link></td><td>{canReadAccounts ? item.order.customer.name : "Restricted"}</td><td>{item.description}</td><td>{item.quantity}</td></tr>)}
      </tbody></table></div> : <EmptyState title="No order history" description="This product has not been added to an order." />}
    </section>}
    <section className="panel section-spacer">
      <div className="panel-header"><div><h2>Purchased units</h2><p>Serial-numbered units and customer history</p></div></div>
      {product.units.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Serial</th><th>Account</th><th>Replaced by</th></tr></thead><tbody>
        {product.units.map((unit) => <tr key={unit.id}><td>{unit.serial}</td><td>{canReadAccounts ? <Link className="record-link" href={`/customers/${unit.customer.id}`}>{unit.customer.name}</Link> : "Restricted"}</td><td>{unit.replacement?.serial || "—"}</td></tr>)}
      </tbody></table></div> : <EmptyState title="No purchased units" description="Serial-tracked units appear here after order delivery." />}
    </section>
  </>;
}
