"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight, BriefcaseBusiness, CalendarDays, Check, ChevronDown, CirclePlus,
  Clock3, FileText, Headset, Laptop, Search, Truck, Users, X,
} from "lucide-react";
import { AppShell, EmptyState, PageHeader, StatusBadge } from "@/components/app-shell";
import { CrmSetupPreview } from "@/components/crm-setup-preview";

type ModuleKey = "leads" | "customers" | "products" | "quotes" | "orders" | "service";
type DemoRecord = {
  id: string;
  reference: string;
  name: string;
  status: string;
  contact: string;
  detail: string;
  value: string;
  date: string;
};
type DemoData = Record<ModuleKey, DemoRecord[]>;
type TaskItem = { id: string; label: string; due: string; done: boolean };
type RecentTab = "Leads" | "Quotes" | "Orders" | "Service";

const STORAGE_KEY = "anu-computers-crm-preview-v1";
const TASKS_KEY = "anu-computers-crm-preview-tasks-v1";

const moduleInfo: Record<ModuleKey, { title: string; singular: string; description: string; icon: typeof Users; columns: string[] }> = {
  leads: { title: "Leads", singular: "Lead", description: "Track enquiries, owners, and next follow-ups.", icon: BriefcaseBusiness, columns: ["Lead", "Contact", "Interest", "Next action", "Status"] },
  customers: { title: "Customers", singular: "Customer", description: "Keep business and contact details together.", icon: Users, columns: ["Customer", "Contact", "Relationship", "Recent activity", "Status"] },
  products: { title: "Products", singular: "Product", description: "Browse the catalogue, pricing, and warranty policies.", icon: Laptop, columns: ["Product", "SKU / model", "Tracking", "Price", "Status"] },
  quotes: { title: "Quotes", singular: "Quote", description: "Prepare customer quotations and follow responses.", icon: FileText, columns: ["Quote", "Customer", "Items", "Total", "Status"] },
  orders: { title: "Orders", singular: "Order", description: "Review fulfilment, shipments, and delivery progress.", icon: Truck, columns: ["Order", "Customer", "Items", "Total", "Status"] },
  service: { title: "Service", singular: "Service ticket", description: "Review support requests, priority, and status.", icon: Headset, columns: ["Ticket", "Customer", "Issue", "Opened", "Status"] },
};

const initialData: DemoData = {
  leads: [
    { id: "lead-1", reference: "LEAD-2047", name: "Bright Tech Solutions", status: "QUALIFIED", contact: "Karan Mehta · +91 98765 12047", detail: "10 business laptops · Call back today", value: "₹8,50,000", date: "Due today" },
    { id: "lead-2", reference: "LEAD-2046", name: "City Edu Institute", status: "CONTACTED", contact: "Priya Nair · +91 98765 12046", detail: "Computer lab refresh · Send quote", value: "₹2,35,000", date: "Due tomorrow" },
    { id: "lead-3", reference: "LEAD-2045", name: "Greenfield Traders", status: "NEW", contact: "Amit Shah · +91 98765 12045", detail: "Workstation upgrade · First call", value: "₹67,000", date: "Nov 7" },
  ],
  customers: [
    { id: "customer-1", reference: "CUS-0108", name: "Bright Tech Solutions", status: "ACTIVE", contact: "Karan Mehta · +91 98765 12047", detail: "Business · Bengaluru", value: "12 orders", date: "Today" },
    { id: "customer-2", reference: "CUS-0107", name: "City Edu Institute", status: "ACTIVE", contact: "Priya Nair · +91 98765 12046", detail: "Education · Mysuru", value: "5 orders", date: "Yesterday" },
    { id: "customer-3", reference: "CUS-0106", name: "Greenfield Traders", status: "ACTIVE", contact: "Amit Shah · +91 98765 12045", detail: "Business · Bengaluru", value: "2 orders", date: "Nov 3" },
  ],
  products: [
    { id: "product-1", reference: "ANU-LTP-14P", name: "14-inch Business Laptop", status: "ACTIVE", contact: "Northstar · WorkPro 14", detail: "Serial tracked · 24-month warranty", value: "₹85,000", date: "In stock" },
    { id: "product-2", reference: "ANU-IC-AT32", name: "AT32 Control IC", status: "ACTIVE", contact: "MicroCore · MC-AT32-01", detail: "Quantity tracked · No warranty", value: "₹145.50", date: "In stock" },
    { id: "product-3", reference: "ANU-MON-24F", name: "24-inch FHD Monitor", status: "ACTIVE", contact: "ViewPoint · VP24-FHD", detail: "Serial tracked · 12-month warranty", value: "₹12,500", date: "Low stock" },
  ],
  quotes: [
    { id: "quote-1", reference: "QUO-2047", name: "Bright Tech Solutions", status: "SENT", contact: "3 products · Created by Admin", detail: "Valid through Nov 15", value: "₹8,50,000", date: "Nov 4" },
    { id: "quote-2", reference: "QUO-2046", name: "City Edu Institute", status: "DRAFT", contact: "5 products · Created by Admin", detail: "Needs review before sending", value: "₹2,35,000", date: "Nov 4" },
    { id: "quote-3", reference: "QUO-2045", name: "Greenfield Traders", status: "ACCEPTED", contact: "2 products · Created by Admin", detail: "Converted to order", value: "₹67,000", date: "Nov 2" },
  ],
  orders: [
    { id: "order-1", reference: "ORD-1058", name: "Bright Tech Solutions", status: "OPEN", contact: "3 products · 8 units", detail: "Dispatch pending", value: "₹1,28,500", date: "Nov 5" },
    { id: "order-2", reference: "ORD-1057", name: "City Edu Institute", status: "PARTIALLY_SHIPPED", contact: "5 products · 12 units", detail: "5 of 12 units delivered", value: "₹2,35,000", date: "Nov 4" },
    { id: "order-3", reference: "ORD-1056", name: "Greenfield Traders", status: "DELIVERED", contact: "2 products · 2 units", detail: "Delivered Nov 3", value: "₹67,000", date: "Nov 3" },
  ],
  service: [
    { id: "ticket-1", reference: "ST-0312", name: "Laptop will not power on", status: "IN_PROGRESS", contact: "City Edu Institute · AC-LT-004", detail: "Warranty active · Normal priority", value: "Normal", date: "Jan 23" },
    { id: "ticket-2", reference: "ST-0311", name: "Setup assistance request", status: "NEW", contact: "Bright Tech Solutions · WorkPro 14", detail: "New installation · Low priority", value: "Low", date: "Jan 22" },
    { id: "ticket-3", reference: "ST-0310", name: "Monitor flickering", status: "WAITING", contact: "Greenfield Traders · VP24-FHD", detail: "Waiting for customer response", value: "High", date: "Jan 21" },
  ],
};

const initialTasks: TaskItem[] = [
  { id: "task-1", label: "Follow up with Bright Tech (Quote Q-2047)", due: "Due today", done: false },
  { id: "task-2", label: "Confirm dispatch for ORD-1058", due: "Due today", done: false },
  { id: "task-3", label: "Get response on Quote Q-2046 (City Edu)", due: "Due tomorrow", done: false },
  { id: "task-4", label: "Update service ticket ST-0312", due: "Due tomorrow", done: false },
  { id: "task-5", label: "Call back Greenfield Traders", due: "Nov 7", done: true },
];

const recentTabs: RecentTab[] = ["Leads", "Quotes", "Orders", "Service"];
const tabToModule: Record<RecentTab, ModuleKey> = { Leads: "leads", Quotes: "quotes", Orders: "orders", Service: "service" };
const createFields: Record<ModuleKey, { label: string; placeholder: string }[]> = {
  leads: [{ label: "Name", placeholder: "Contact or company name" }, { label: "Contact", placeholder: "Name · phone or email" }, { label: "Detail", placeholder: "Product interest and next step" }],
  customers: [{ label: "Name", placeholder: "Customer or business name" }, { label: "Contact", placeholder: "Primary contact details" }, { label: "Detail", placeholder: "Customer type · city" }],
  products: [{ label: "Name", placeholder: "Product name" }, { label: "Contact", placeholder: "Brand · model" }, { label: "Value", placeholder: "Unit price, e.g. ₹12,500" }, { label: "Detail", placeholder: "Tracking type · warranty" }],
  quotes: [{ label: "Name", placeholder: "Customer name" }, { label: "Contact", placeholder: "Number of products · owner" }, { label: "Value", placeholder: "Quote total, e.g. ₹25,000" }, { label: "Detail", placeholder: "Validity or notes" }],
  orders: [{ label: "Name", placeholder: "Customer name" }, { label: "Contact", placeholder: "Number of products · units" }, { label: "Value", placeholder: "Order total, e.g. ₹25,000" }, { label: "Detail", placeholder: "Dispatch or delivery note" }],
  service: [{ label: "Name", placeholder: "Issue summary" }, { label: "Contact", placeholder: "Customer · product / serial" }, { label: "Value", placeholder: "Priority: Normal, High, Urgent" }, { label: "Detail", placeholder: "Issue details" }],
};

function createInitialData(): DemoData {
  return JSON.parse(JSON.stringify(initialData)) as DemoData;
}

function makeReference(module: ModuleKey, records: DemoRecord[]) {
  const prefix: Record<ModuleKey, string> = { leads: "LEAD", customers: "CUS", products: "ANU-NEW", quotes: "QUO", orders: "ORD", service: "ST" };
  const number = String(records.length + 2048).padStart(4, "0");
  return `${prefix[module]}-${number}`;
}

function recordSummary(module: ModuleKey, item: DemoRecord) {
  switch (module) {
    case "leads": return item.detail;
    case "customers": return item.detail;
    case "products": return item.contact;
    case "quotes": return item.contact;
    case "orders": return item.contact;
    case "service": return item.contact;
  }
}

export function PreviewWorkspace({ name }: { name: string }) {
  const pathname = usePathname();
  const currentPath = pathname === "/" ? "/dashboard" : pathname;
  const [data, setData] = useState<DemoData>(createInitialData);
  const [tasks, setTasks] = useState<TaskItem[]>(initialTasks);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<RecentTab>("Orders");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<{ module: ModuleKey; item: DemoRecord } | null>(null);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<DemoData>;
        setData({ ...createInitialData(), ...parsed });
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
      }
      const savedTasks = localStorage.getItem(TASKS_KEY);
      if (savedTasks) setTasks(JSON.parse(savedTasks) as TaskItem[]);
      else localStorage.setItem(TASKS_KEY, JSON.stringify(initialTasks));
    } catch (error) {
      console.error("Could not load browser preview data.", error);
      setStorageError("Could not load this browser’s demo data. Check browser storage settings.");
    } finally {
      setLoaded(true);
    }
  }, []);

  function saveData(next: DemoData) {
    setData(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("Could not save browser preview data.", error);
      setStorageError("Could not save changes in this browser. Check available storage.");
    }
  }

  function toggleTask(id: string) {
    const next = tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task);
    setTasks(next);
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("Could not save browser preview tasks.", error);
      setStorageError("Could not save task changes in this browser. Check available storage.");
    }
  }

  const moduleKey = currentPath.split("/")[1] as ModuleKey;
  const isModulePage = moduleKey in moduleInfo;
  const visibleRecords = useMemo(() => {
    if (!isModulePage) return [];
    return data[moduleKey].filter((item) => {
      const matchesSearch = `${item.reference} ${item.name} ${item.contact} ${item.detail}`.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data, isModulePage, moduleKey, search, statusFilter]);

  function createRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isModulePage) return;
    const formData = new FormData(event.currentTarget);
    const records = data[moduleKey];
    const record: DemoRecord = {
      id: `${moduleKey}-${crypto.randomUUID()}`,
      reference: makeReference(moduleKey, records),
      name: String(formData.get("name") || "").trim(),
      status: moduleKey === "leads" ? "NEW" : moduleKey === "quotes" ? "DRAFT" : moduleKey === "orders" ? "OPEN" : moduleKey === "service" ? "NEW" : "ACTIVE",
      contact: String(formData.get("contact") || "").trim() || "Not specified",
      detail: String(formData.get("detail") || "").trim() || "Added in local demo",
      value: String(formData.get("value") || "").trim() || "—",
      date: "Just now",
    };
    saveData({ ...data, [moduleKey]: [record, ...records] });
    setCreateOpen(false);
    event.currentTarget.reset();
  }

  function updateSelectedStatus(status: string) {
    if (!selected) return;
    const next = { ...data, [selected.module]: data[selected.module].map((item) => item.id === selected.item.id ? { ...item, status } : item) };
    saveData(next);
    setSelected({ ...selected, item: { ...selected.item, status } });
  }

  return <AppShell user={{ name, email: "", role: "PREVIEW" }} previewMode>
    {currentPath === "/crm-setup" || currentPath.startsWith("/custom/") ? <CrmSetupPreview pathname={currentPath} /> : currentPath === "/dashboard" ? <Dashboard
      data={data}
      tasks={tasks}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onTaskToggle={toggleTask}
      onSelect={(module, item) => setSelected({ module, item })}
    /> : isModulePage ? <ModulePage
      module={moduleKey}
      records={visibleRecords}
      search={search}
      statusFilter={statusFilter}
      onSearch={setSearch}
      onStatusFilter={setStatusFilter}
      onCreate={() => setCreateOpen(true)}
      onSelect={(item) => setSelected({ module: moduleKey, item })}
    /> : currentPath === "/settings" ? <SettingsPreview /> : <Dashboard
      data={data}
      tasks={tasks}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onTaskToggle={toggleTask}
      onSelect={(module, item) => setSelected({ module, item })}
    />}
    {!loaded && <div className="preview-toast" role="status">Loading this browser’s demo data…</div>}
    {storageError && <div className="preview-storage-error" role="alert">{storageError}</div>}
    {createOpen && isModulePage && <CreateDialog module={moduleKey} onClose={() => setCreateOpen(false)} onSubmit={createRecord} />}
    {selected && <RecordDialog selected={selected} onClose={() => setSelected(null)} onStatusChange={updateSelectedStatus} />}
  </AppShell>;
}

function Dashboard({ data, tasks, activeTab, onTabChange, onTaskToggle, onSelect }: {
  data: DemoData;
  tasks: TaskItem[];
  activeTab: RecentTab;
  onTabChange: (tab: RecentTab) => void;
  onTaskToggle: (id: string) => void;
  onSelect: (module: ModuleKey, item: DemoRecord) => void;
}) {
  const metrics = [
    { title: "Follow-ups due", value: String(data.leads.filter((item) => item.status !== "CONVERTED").length), detail: "Leads needing attention", module: "leads" as ModuleKey, icon: CalendarDays },
    { title: "Quotes awaiting", value: String(data.quotes.filter((item) => item.status === "SENT" || item.status === "DRAFT").length), detail: "Sent, awaiting response", module: "quotes" as ModuleKey, icon: FileText },
    { title: "Orders to dispatch", value: String(data.orders.filter((item) => item.status === "OPEN" || item.status === "PARTIALLY_SHIPPED").length), detail: "Open or partially shipped", module: "orders" as ModuleKey, icon: Truck },
    { title: "Open service tickets", value: String(data.service.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).length), detail: "Assigned and in progress", module: "service" as ModuleKey, icon: Headset },
  ];
  const recent = data[tabToModule[activeTab]].slice(0, 5);
  return <>
    <PageHeader eyebrow="OPERATIONS OVERVIEW" title="Operations overview" description="A clear view of follow-ups, orders, and service work." />
    <div className="metric-grid">
      {metrics.map((metric) => <a className="metric-card" href={`/${metric.module}`} key={metric.title}>
        <div className="metric-top"><span>{metric.title}</span><span className="metric-icon"><metric.icon size={16} /></span></div>
        <div className="metric-number">{metric.value}<ArrowUpRight size={17} color="#2867e8" /></div><div className="metric-foot">{metric.detail}</div>
      </a>)}
    </div>
    <div className="preview-dashboard-grid">
      <section className="panel preview-activity-panel">
        <div className="panel-header"><div><h2>Recent activity</h2><p>Browse demo records by workflow</p></div><a className="text-link" href={`/${tabToModule[activeTab]}`}>View all <ArrowUpRight size={14} /></a></div>
        <div className="preview-tabs" role="tablist" aria-label="Recent activity type">
          {recentTabs.map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => onTabChange(tab)}>{tab}</button>)}
        </div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>{activeTab === "Service" ? "Issue" : "Customer / record"}</th><th>Details</th><th>Value</th><th>Status</th></tr></thead><tbody>
          {recent.map((item) => <tr key={item.id} className="preview-clickable-row" onClick={() => onSelect(tabToModule[activeTab], item)}><td><strong className="table-primary">{item.reference}</strong></td><td>{item.name}</td><td>{recordSummary(tabToModule[activeTab], item)}</td><td>{item.value}</td><td><StatusBadge>{item.status}</StatusBadge></td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel preview-task-panel">
        <div className="panel-header"><div><h2>Task queue</h2><p>Click a task to mark it done</p></div><span className="preview-task-count">{tasks.filter((task) => !task.done).length} open</span></div>
        <div className="preview-task-list">{tasks.map((task) => <button key={task.id} className={`preview-task ${task.done ? "done" : ""}`} onClick={() => onTaskToggle(task.id)}>
          <span className={`preview-checkbox ${task.done ? "checked" : ""}`}>{task.done && <Check size={13} />}</span>
          <span className="preview-task-label">{task.label}</span>
          <span className={`preview-due ${task.due === "Due today" ? "today" : ""}`}>{task.done ? "Done" : task.due}</span>
        </button>)}</div>
      </section>
    </div>
    <div className="preview-dashboard-note"><Clock3 size={15} /> Fictional demo content. Your changes are saved in this browser only.</div>
  </>;
}

function ModulePage({ module, records, search, statusFilter, onSearch, onStatusFilter, onCreate, onSelect }: {
  module: ModuleKey;
  records: DemoRecord[];
  search: string;
  statusFilter: string;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onCreate: () => void;
  onSelect: (item: DemoRecord) => void;
}) {
  const info = moduleInfo[module];
  const Icon = info.icon;
  const statuses = Array.from(new Set(Object.values(initialData[module]).map((item) => item.status)));
  return <>
    <PageHeader eyebrow="WORKSPACE" title={info.title} description={info.description} action={<button className="button button-primary" onClick={onCreate}><CirclePlus size={16} /> New {info.singular.toLowerCase()}</button>} />
    <div className="preview-module-note"><strong>Browser demo</strong><span>Add sample records or update statuses. Changes are saved in this browser only.</span></div>
    <div className="toolbar preview-toolbar">
      <label className="filter-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={`Search ${info.title.toLowerCase()}…`} aria-label={`Search ${info.title}`} /></label>
      <label className="preview-filter"><span>Status</span><select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{statuses.map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select><ChevronDown size={14} /></label>
    </div>
    <section className="panel">
      {records.length ? <div className="table-wrap"><table className="data-table preview-module-table"><thead><tr>{info.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
        {records.map((item) => <tr className="preview-clickable-row" key={item.id} onClick={() => onSelect(item)}>
          <td><strong className="table-primary">{item.reference}</strong><span className="table-sub">{item.name}</span></td>
          <td>{module === "quotes" || module === "orders" ? item.name : item.contact}</td>
          <td>{module === "leads" || module === "customers" || module === "products" || module === "service" ? item.detail : item.contact}</td>
          <td>{module === "leads" || module === "service" ? item.date : item.value}</td>
          <td><StatusBadge>{item.status}</StatusBadge></td>
        </tr>)}
      </tbody></table></div> : <EmptyState title={`No ${info.title.toLowerCase()} found`} description="Try a different search or add a new demo record." />}
      <div className="preview-table-footer"><span>{records.length} demo records</span><span><Icon size={14} /> Local preview</span></div>
    </section>
  </>;
}

function CreateDialog({ module, onClose, onSubmit }: { module: ModuleKey; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const info = moduleInfo[module];
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog preview-dialog" role="dialog" aria-modal="true" aria-labelledby="create-record-title">
      <div className="dialog-header"><div><div className="eyebrow">LOCAL DEMO</div><h2 id="create-record-title">New {info.singular.toLowerCase()}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={onSubmit}><div className="form-grid">
        {createFields[module].map((field) => <label className="field field-full" key={field.label}><span>{field.label} {field.label === "Name" ? "*" : ""}</span><input name={field.label.toLowerCase()} placeholder={field.placeholder} required={field.label === "Name"} maxLength={180} /></label>)}
      </div>
      <p className="preview-dialog-note">This demo record is stored in this browser and is not sent to a server.</p>
      <div className="dialog-footer"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary">Add demo record</button></div></form>
    </section>
  </div>;
}

function RecordDialog({ selected, onClose, onStatusChange }: {
  selected: { module: ModuleKey; item: DemoRecord };
  onClose: () => void;
  onStatusChange: (status: string) => void;
}) {
  const info = moduleInfo[selected.module];
  const [status, setStatus] = useState(selected.item.status);
  const allowedStatuses = Array.from(new Set([...Object.values(initialData[selected.module]).map((item) => item.status), selected.item.status]));
  function updateStatus(next: string) {
    setStatus(next);
    onStatusChange(next);
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog preview-dialog" role="dialog" aria-modal="true" aria-labelledby="record-detail-title">
      <div className="dialog-header"><div><div className="eyebrow">{selected.item.reference}</div><h2 id="record-detail-title">{selected.item.name}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <div className="preview-record-details">
        <div><small>Type</small><strong>{info.singular}</strong></div>
        <div><small>Contact / model</small><strong>{selected.item.contact}</strong></div>
        <div><small>Details</small><strong>{selected.item.detail}</strong></div>
        <div><small>{selected.module === "leads" ? "Next follow-up" : "Value"}</small><strong>{selected.module === "leads" ? selected.item.date : selected.item.value}</strong></div>
        <label className="field preview-status-field"><span>Status</span><select value={status} onChange={(event) => updateStatus(event.target.value)}>{allowedStatuses.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      </div>
      <p className="preview-dialog-note">Status changes are saved in this browser only. Database workflows are not active in preview mode.</p>
      <div className="dialog-footer"><button className="button button-primary" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}

function SettingsPreview() {
  return <>
    <PageHeader eyebrow="WORKSPACE" title="Settings" description="Preview the administration workspace." />
    <div className="preview-module-note"><strong>Local demo settings</strong><span>This preview does not change your application or database configuration.</span></div>
    <section className="panel preview-settings">
      <div className="panel-header"><div><h2>Workspace configuration</h2><p>Read-only sample settings</p></div></div>
      <div className="preview-record-details">
        <div><small>Business name</small><strong>Anu Computers</strong></div>
        <div><small>Timezone</small><strong>Asia/Kolkata</strong></div>
        <div><small>Default warranty</small><strong>12 months</strong></div>
        <div><small>Database</small><strong>Not connected — browser demo mode</strong></div>
        <div><small>Data storage</small><strong>This browser only</strong></div>
      </div>
    </section>
  </>;
}
