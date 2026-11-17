import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { PageHeader } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [readAuthorization, accountReadAuthorization, editAuthorization, deleteAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canDelete" }),
  ]);
  if (!readAuthorization.allowed || !accountReadAuthorization.allowed) notFound();
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Contact: ["Name", "FirstName", "LastName", "AccountId", "Title", "Email", "Phone", "Primary"],
    Account: ["Name"],
  });
  if (!fieldAuthorization.allowed) notFound();
  const editFields = editAuthorization.allowed
    ? await evaluateNativeFieldAuthorizations(user, {
      Contact: ["FirstName", "LastName", "AccountId", "Title", "Email", "Phone", "Primary"],
    }, "edit")
    : null;
  const { id } = await params;
  const contactRecord = await getNativeCrmRecord("Contact", id, user);
  if (!contactRecord) notFound();
  const accountIds = await listNativeCrmRecordIds("Account", user);
  const contact = await prisma.contact.findFirst({
    where: { id, customerId: { in: accountIds } },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!contact) notFound();
  const canEdit = editAuthorization.allowed && Boolean(editFields?.allowed);
  const canDelete = deleteAuthorization.allowed;
  const accounts = await prisma.customer.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 });
  return <>
    <div className="breadcrumb"><Link href="/contacts">Contacts</Link> / {contact.name}</div>
    <PageHeader eyebrow="CONTACT RECORD" title={contact.name} description={contact.title || "Contact"}
      action={<div className="header-form-actions">
        {canEdit && <RecordForm title="Edit contact" endpoint={`/api/contacts/${id}`} method="PATCH" submitLabel="Save contact" fields={[
          { name: "customerId", label: "Account", type: "select", required: true, defaultValue: contact.customerId, options: accounts.map((account) => ({ label: account.name, value: account.id })) },
          { name: "firstName", label: "First name", defaultValue: contact.firstName || "" },
          { name: "lastName", label: "Last name", required: true, defaultValue: contact.lastName || contact.name },
          { name: "email", label: "Email", type: "email", defaultValue: contact.email || "" },
          { name: "phone", label: "Phone", type: "tel", defaultValue: contact.phone || "" },
          { name: "title", label: "Job title", defaultValue: contact.title || "" },
          { name: "primary", label: "Primary contact", type: "select", defaultValue: String(contact.primary), options: [{ label: "No", value: "false" }, { label: "Yes", value: "true" }] },
        ]} />}
        {canDelete && <DeleteRecordButton endpoint={`/api/contacts/${id}`} returnTo="/contacts" recordLabel={`contact ${contact.name}`} />}
      </div>}
    />
    <section className="detail-grid">
      <div className="detail-card"><small>Account</small><strong><Link href={`/customers/${contact.customer.id}`} className="record-link">{contact.customer.name}</Link></strong></div>
      <div className="detail-card"><small>Email</small><strong>{contact.email || "—"}</strong></div>
      <div className="detail-card"><small>Phone</small><strong>{contact.phone || "—"}</strong></div>
      <div className="detail-card"><small>Primary contact</small><strong>{contact.primary ? "Yes" : "No"}</strong></div>
    </section>
  </>;
}
