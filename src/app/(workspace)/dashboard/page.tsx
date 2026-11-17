import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Clock3, FileText, Headset, PackageCheck, Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/app-shell";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function DashboardPage() {
  const user = await requireUser();
  if (user.preview) return <PreviewDashboard name={user.name} />;
  const now = new Date();
  const [leadAuthorization, quoteAuthorization, orderAuthorization, caseAuthorization, accountAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { capability: "leads:read", objectApiName: "Lead", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "quotes:read", objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "orders:read", objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "service:read", objectApiName: "Case", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
  ]);
  const [leadFields, quoteFields, orderFields, caseFields, accountFields] = await Promise.all([
    leadAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Lead: ["Name", "Reference", "Interest", "Status", "NextFollowUpAt"] }) : Promise.resolve({ allowed: false as const }),
    quoteAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Quote: ["Status"] }) : Promise.resolve({ allowed: false as const }),
    orderAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Order: ["Status"] }) : Promise.resolve({ allowed: false as const }),
    caseAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Case: ["CaseNumber", "Subject", "Status", "Priority", "AccountId"] }) : Promise.resolve({ allowed: false as const }),
    caseAuthorization.allowed && accountAuthorization.allowed
      ? evaluateNativeFieldAuthorizations(user, { Account: ["Name"] })
      : Promise.resolve({ allowed: false as const }),
  ]);
  const canReadLeads = leadAuthorization.allowed && leadFields.allowed;
  const canReadQuotes = quoteAuthorization.allowed && quoteFields.allowed;
  const canReadOrders = orderAuthorization.allowed && orderFields.allowed;
  const canReadCases = caseAuthorization.allowed && caseFields.allowed;
  const canReadAccountNames = accountAuthorization.allowed && accountFields.allowed;
  const [leadIds, quoteIds, orderIds, caseIds] = await Promise.all([
    canReadLeads ? listNativeCrmRecordIds("Lead", user) : Promise.resolve([]),
    canReadQuotes ? listNativeCrmRecordIds("Quote", user) : Promise.resolve([]),
    canReadOrders ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    canReadCases ? listNativeCrmRecordIds("Case", user) : Promise.resolve([]),
  ]);
  const [leadsDue, quotesWaiting, ordersDispatch, openTickets, followUps, recentTickets] = await Promise.all([
    canReadLeads ? prisma.lead.count({
      where: { id: { in: leadIds }, nextFollowUpAt: { lte: now }, status: { notIn: ["CONVERTED", "DISQUALIFIED"] } },
    }) : Promise.resolve(0),
    canReadQuotes ? prisma.quote.count({ where: { id: { in: quoteIds }, status: "SENT" } }) : Promise.resolve(0),
    canReadOrders ? prisma.order.count({ where: { id: { in: orderIds }, status: { in: ["OPEN", "PARTIALLY_SHIPPED"] } } }) : Promise.resolve(0),
    canReadCases ? prisma.serviceTicket.count({
      where: { id: { in: caseIds }, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"] } },
    }) : Promise.resolve(0),
    canReadLeads ? prisma.lead.findMany({
      where: { id: { in: leadIds }, nextFollowUpAt: { lte: now }, status: { notIn: ["CONVERTED", "DISQUALIFIED"] } },
      include: { assignee: { select: { name: true } } },
      orderBy: { nextFollowUpAt: "asc" },
      take: 6,
    }) : Promise.resolve([]),
    canReadCases ? prisma.serviceTicket.findMany({
      where: { id: { in: caseIds }, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"] } },
      include: { customer: { select: { name: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 5,
    }) : Promise.resolve([]),
  ]);
  const metrics = [
    { title: "Follow-ups due", value: leadsDue, detail: "Leads needing attention", href: "/leads?due=true", icon: BriefcaseBusiness, show: canReadLeads },
    { title: "Quotes awaiting", value: quotesWaiting, detail: "Sent, awaiting response", href: "/quotes?status=SENT", icon: FileText, show: canReadQuotes },
    { title: "Orders to dispatch", value: ordersDispatch, detail: "Open or partially shipped", href: "/orders?dispatch=pending", icon: Truck, show: canReadOrders },
    { title: "Open service tickets", value: openTickets, detail: "Assigned and in progress", href: "/service?open=true", icon: Headset, show: canReadCases },
  ].filter((metric) => metric.show);

  return <>
    <PageHeader eyebrow="OVERVIEW" title={`Good day, ${user.name.split(" ")[0]}`} description="Here’s what needs your team’s attention today." />
    <div className="metric-grid">
      {metrics.map((metric) => <Link href={metric.href} className="metric-card" key={metric.title}>
        <div className="metric-top"><span>{metric.title}</span><span className="metric-icon"><metric.icon size={16} /></span></div>
        <div className="metric-number">{metric.value}</div><div className="metric-foot">{metric.detail}</div>
      </Link>)}
    </div>
    <div className="dashboard-grid">
      {canReadLeads && <section className="panel">
        <div className="panel-header"><div><h2>Follow-ups to work</h2><p>Due and overdue lead activity</p></div><Link className="text-link" href="/leads">All leads <ArrowRight size={14} /></Link></div>
        {followUps.length ? <div className="queue-list">{followUps.map((lead) => <Link className="queue-item" href={`/leads/${lead.id}`} key={lead.id}>
          <div className="queue-main"><strong>{lead.name}</strong><small>{lead.reference} · {lead.interest || "Product interest not noted"}</small></div>
          <div className="queue-meta"><small>{dateTime(lead.nextFollowUpAt)}</small><StatusBadge>{lead.status}</StatusBadge></div>
        </Link>)}</div> : <EmptyState title="You’re all caught up" description="No due follow-ups right now. New activity will appear here." />}
      </section>}
      {canReadCases && <section className="panel">
        <div className="panel-header"><div><h2>Service queue</h2><p>Open tickets by urgency</p></div><Link className="text-link" href="/service">View queue <ArrowRight size={14} /></Link></div>
        {recentTickets.length ? <div className="queue-list">{recentTickets.map((ticket) => <Link className="queue-item" href={`/service/${ticket.id}`} key={ticket.id}>
          <div className="queue-main"><strong>{ticket.title}</strong><small>{ticket.reference} · {canReadAccountNames ? ticket.customer.name : "Restricted"}</small></div>
          <div className="queue-meta"><StatusBadge>{ticket.priority}</StatusBadge><StatusBadge>{ticket.status}</StatusBadge></div>
        </Link>)}</div> : <EmptyState title="No open tickets" description="New service requests will appear in this queue." />}
      </section>}
      {!canReadCases && canReadOrders && <section className="panel">
        <div className="panel-header"><div><h2>Dispatch queue</h2><p>Orders ready for shipment</p></div><Link className="text-link" href="/orders">View orders <ArrowRight size={14} /></Link></div>
        <div className="queue-item"><div className="queue-main"><strong>{ordersDispatch} orders need dispatch</strong><small>Check the order queue for quantities and shipping details.</small></div><PackageCheck size={19} color="#5380c7" /></div>
      </section>}
    </div>
    <div className="dashboard-note"><Clock3 size={15} /> Times shown in {process.env.BUSINESS_TIMEZONE || "Asia/Kolkata"} timezone.</div>
  </>;
}

function PreviewDashboard({ name }: { name: string }) {
  const metrics = [
    { title: "Follow-ups due", value: "3", detail: "Sample leads needing attention", icon: BriefcaseBusiness },
    { title: "Quotes awaiting", value: "2", detail: "Sample quotes sent", icon: FileText },
    { title: "Orders to dispatch", value: "1", detail: "Sample open orders", icon: Truck },
    { title: "Open service tickets", value: "2", detail: "Sample service requests", icon: Headset },
  ];

  return <>
    <PageHeader eyebrow="SAMPLE OVERVIEW" title={`Good day, ${name.split(" ")[0]}`} description="Explore the CRM dashboard layout with fictional preview content." />
    <div className="metric-grid">
      {metrics.map((metric) => <div className="metric-card" key={metric.title}>
        <div className="metric-top"><span>{metric.title}</span><span className="metric-icon"><metric.icon size={16} /></span></div>
        <div className="metric-number">{metric.value}</div><div className="metric-foot">{metric.detail}</div>
      </div>)}
    </div>
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-header"><div><h2>Follow-ups to work</h2><p>Fictional demo lead activity</p></div></div>
        <div className="queue-list">
          <div className="queue-item"><div className="queue-main"><strong>Riya Mehta</strong><small>LEAD-DEMO-001 · Business laptops</small></div><div className="queue-meta"><StatusBadge>QUALIFIED</StatusBadge></div></div>
          <div className="queue-item"><div className="queue-main"><strong>Arjun Rao</strong><small>LEAD-DEMO-002 · Office accessories</small></div><div className="queue-meta"><StatusBadge>CONTACTED</StatusBadge></div></div>
          <div className="queue-item"><div className="queue-main"><strong>Meera Shah</strong><small>LEAD-DEMO-003 · Workstation upgrade</small></div><div className="queue-meta"><StatusBadge>NEW</StatusBadge></div></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Service queue</h2><p>Sample tickets by urgency</p></div></div>
        <div className="queue-list">
          <div className="queue-item"><div className="queue-main"><strong>Laptop setup assistance</strong><small>TKT-DEMO-001 · Bluebell Design Studio</small></div><div className="queue-meta"><StatusBadge>IN_PROGRESS</StatusBadge></div></div>
          <div className="queue-item"><div className="queue-main"><strong>Warranty inspection</strong><small>TKT-DEMO-002 · Sample customer</small></div><div className="queue-meta"><StatusBadge>NORMAL</StatusBadge></div></div>
        </div>
      </section>
    </div>
    <div className="preview-dashboard-note"><Clock3 size={15} /> Preview data is fictional. Connect a database to use CRM records and workflows.</div>
  </>;
}
