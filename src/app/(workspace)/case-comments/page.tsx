import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { dateTime } from "@/lib/format";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function CaseCommentsPage() {
  const user = await requireUser();
  const authorization = await evaluateUserAuthorization(user, { objectApiName: "CaseComment", objectCapability: "canRead" });
  if (!authorization.allowed) {
    return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to case comments." /></div>;
  }
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    CaseComment: ["CaseId", "AuthorId", "Type", "Comment", "CreatedAt"],
    Case: ["CaseNumber", "Subject"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const [commentIds, caseIds] = await Promise.all([
    listNativeCrmRecordIds("CaseComment", user),
    listNativeCrmRecordIds("Case", user),
  ]);
  const updates = await prisma.ticketUpdate.findMany({
    where: { id: { in: commentIds }, ticketId: { in: caseIds } },
    include: { ticket: { select: { id: true, reference: true, title: true } }, author: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return <>
    <PageHeader eyebrow="CUSTOMER CARE" title="Case Comments" description="Case comments are added and maintained on their parent case to preserve history." />
    <section className="panel">{updates.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Case</th><th>Comment</th><th>Type</th><th>Author</th><th>Created</th></tr></thead><tbody>
      {updates.map((update) => <tr key={update.id}><td><Link className="table-primary" href={`/service/${update.ticket.id}`}>{update.ticket.reference}</Link><span className="table-sub">{update.ticket.title}</span></td><td>{update.note}</td><td>{update.kind.replaceAll("_", " ")}</td><td>{update.author.name}</td><td>{dateTime(update.createdAt)}</td></tr>)}
    </tbody></table></div> : <EmptyState title="No case comments" description="Comments and service updates will appear here when added to a case." />}</section>
  </>;
}
