import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { money } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { evaluateNativeFieldAuthorization, evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const [readAuthorization, createAuthorization, editAuthorization, quoteReadAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
  ]);
  const canReadProducts = readAuthorization.allowed;
  const canCreateProducts = createAuthorization.allowed;
  const canEditProducts = editAuthorization.allowed;
  let canReadQuoteData = quoteReadAuthorization.allowed;
  if (!canReadProducts) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to product records." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Product: ["ProductCode", "Name", "Brand", "Model", "ManufacturerPart", "TrackingType", "WarrantyMonths", "CategoryId"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const priceReadAuthorization = canReadQuoteData
    ? await evaluateNativeFieldAuthorization(user, "Product", ["Price"], "read")
    : null;
  if (priceReadAuthorization && !priceReadAuthorization.allowed) canReadQuoteData = false;
  const productEditFields = ["ProductCode", "Name", "Description", "Brand", "Model", "ManufacturerPart", "Price", "TrackingType", "WarrantyMonths", "Active", "CategoryId"];
  const editFieldAuthorization = canCreateProducts || canEditProducts
    ? await evaluateNativeFieldAuthorizations(user, { Product: productEditFields }, "edit")
    : null;
  const canCreate = canCreateProducts && Boolean(editFieldAuthorization?.allowed);
  const canEdit = canEditProducts && Boolean(editFieldAuthorization?.allowed);
  const productIds = await listNativeCrmRecordIds("Product", user);
  const [products, categories, warrantyDefault] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, ...(canEditProducts ? {} : { active: true }), ...(query.q ? { OR: [
        { sku: { contains: query.q, mode: "insensitive" } }, { brand: { contains: query.q, mode: "insensitive" } },
        { model: { contains: query.q, mode: "insensitive" } }, { manufacturerPart: { contains: query.q, mode: "insensitive" } },
        { name: { contains: query.q, mode: "insensitive" } },
      ] } : {}) },
      include: { category: true }, orderBy: { name: "asc" }, take: 100,
    }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.businessSetting.findUnique({ where: { key: "defaultWarrantyMonths" }, select: { value: true } }),
  ]);
  return <>
    <PageHeader eyebrow="CATALOG" title="Products" description="Search and manage parts, pricing, warranty, and serial tracking."
      action={canCreate ? <RecordForm title="New product" endpoint="/api/products" fields={[
        { name: "sku", label: "SKU", required: true }, { name: "name", label: "Product name", required: true },
        { name: "description", label: "Description", type: "textarea" },
        { name: "brand", label: "Brand" }, { name: "model", label: "Model" }, { name: "manufacturerPart", label: "Manufacturer part number" },
        { name: "unitPrice", label: "Unit price (INR)", type: "number", required: true },
        { name: "trackingType", label: "Tracking type", type: "select", required: true, defaultValue: "QUANTITY", options: [{ label: "Serialized", value: "SERIAL" }, { label: "Quantity tracked", value: "QUANTITY" }] },
        { name: "warrantyMonths", label: "Warranty (months)", type: "number", defaultValue: warrantyDefault?.value || "0" },
        ...(categories.length ? [{ name: "categoryId", label: "Category", type: "select" as const, options: categories.map((item) => ({ label: item.name, value: item.id })) }] : []),
      ]} /> : undefined}
    />
    <div className="toolbar"><form className="filter-search" method="get"><span>⌕</span><input name="q" defaultValue={query.q} placeholder="Search SKU, brand, model, part no.…" aria-label="Search products" /></form><div className="toolbar-actions"><span>{products.length} products</span></div></div>
    <section className="panel">{products.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Brand / model</th><th>Category</th>{canReadQuoteData && <th>Unit price</th>}<th>Warranty</th><th>Tracking</th>{canEditProducts && <th>Actions</th>}</tr></thead><tbody>
      {products.map((product) => <tr key={product.id}><td><Link className="table-primary" href={`/products/${product.id}`}>{product.name}</Link><span className="table-sub">{product.sku}{product.manufacturerPart ? ` · MPN ${product.manufacturerPart}` : ""}</span></td><td>{[product.brand, product.model].filter(Boolean).join(" / ") || "—"}</td><td>{product.category?.name || "—"}</td>{canReadQuoteData && <td>{money(product.unitPrice)}</td>}<td>{product.warrantyMonths ? `${product.warrantyMonths} months` : "No warranty"}</td><td>{product.trackingType === "SERIAL" ? "Serial tracked" : "Quantity tracked"}</td>{canEdit && <td><RecordForm title="Edit product" endpoint={`/api/products/${product.id}`} method="PATCH" submitLabel="Save product" fields={[
        { name: "sku", label: "SKU", required: true, defaultValue: product.sku }, { name: "name", label: "Product name", required: true, defaultValue: product.name },
        { name: "description", label: "Description", type: "textarea", defaultValue: product.description || "" },
        { name: "brand", label: "Brand", defaultValue: product.brand || "" }, { name: "model", label: "Model", defaultValue: product.model || "" }, { name: "manufacturerPart", label: "Manufacturer part number", defaultValue: product.manufacturerPart || "" },
        { name: "unitPrice", label: "Unit price (INR)", type: "number", required: true, defaultValue: product.unitPrice.toString() },
        { name: "trackingType", label: "Tracking type", type: "select", required: true, defaultValue: product.trackingType, options: [{ label: "Serialized", value: "SERIAL" }, { label: "Quantity tracked", value: "QUANTITY" }] },
        { name: "warrantyMonths", label: "Warranty (months)", type: "number", defaultValue: String(product.warrantyMonths) },
        { name: "categoryId", label: "Category", type: "select", defaultValue: product.categoryId || "", options: [{ label: "No category", value: "" }, ...categories.map((item) => ({ label: item.name, value: item.id }))] },
        { name: "active", label: "Product status", type: "select", required: true, defaultValue: String(product.active), options: [{ label: "Active", value: "true" }, { label: "Inactive", value: "false" }] },
      ]} /></td>}</tr>)}
    </tbody></table></div> : <EmptyState title="No products found" description="Add products and components to make them available in quotes and orders." />}</section>
  </>;
}
