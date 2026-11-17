import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function ContactsPage() {
  const user = await requireUser();
  const [readAuthorization, createAuthorization, accountReadAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Contact", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
  ]);
  const canRead = readAuthorization.allowed;
  const canReadAccounts = accountReadAuthorization.allowed;
  const canCreate = createAuthorization.allowed && canReadAccounts;
  if (!canRead) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to contact records." /></div>;
  if (!canReadAccounts) return <div className="panel"><EmptyState title="Access restricted" description="Account access is required to view related contacts." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Contact: ["Name", "FirstName", "LastName", "AccountId", "Email", "Phone", "Title", "Primary"],
    Account: ["Name"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const [contactIds, accountIds] = await Promise.all([
    listNativeCrmRecordIds("Contact", user),
    listNativeCrmRecordIds("Account", user),
  ]);
  const [contacts, customers] = await Promise.all([
    prisma.contact.findMany({
      where: { id: { in: contactIds }, customerId: { in: accountIds } },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      take: 500,
    }),
    canCreate ? prisma.customer.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }) : Promise.resolve([]),
  ]);
  const addContact = canCreate && customers.length ? <RecordForm title="Add contact" endpoint="/api/contacts" fields={[
    { name: "customerId", label: "Account", type: "select", required: true, options: customers.map((customer) => ({ value: customer.id, label: customer.name })) },
    { name: "firstName", label: "First name" },
    { name: "lastName", label: "Last name", required: true },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "title", label: "Job title" },
    { name: "primary", label: "Primary contact", type: "select", defaultValue: "false", options: [{ label: "No", value: "false" }, { label: "Yes", value: "true" }] },
  ]} /> : undefined;
  return <>
    <PageHeader eyebrow="RELATIONSHIPS" title="Contacts" description="Manage people connected to customer accounts." action={addContact} />
    {canCreate && !customers.length && <p className="panel-empty-copy">Create or gain access to an account before adding a contact.</p>}
    <section className="panel">
      {contacts.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Contact</th><th>Account</th><th>Email</th><th>Phone</th><th>Job title</th></tr></thead><tbody>
        {contacts.map((contact) => <tr key={contact.id}><td><Link className="table-primary" href={`/contacts/${contact.id}`}>{contact.name}{contact.primary ? " · Primary" : ""}</Link></td><td><Link className="record-link" href={`/customers/${contact.customer.id}`}>{contact.customer.name}</Link></td><td>{contact.email || "—"}</td><td>{contact.phone || "—"}</td><td>{contact.title || "—"}</td></tr>)}
      </tbody></table></div> : <EmptyState title="No contacts yet" description="Add a contact and associate them with an account." />}
    </section>
  </>;
}
