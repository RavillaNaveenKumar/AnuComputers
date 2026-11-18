"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BarChart3, Boxes, BriefcaseBusiness, ClipboardList, Database, FileText, Headset,
  Laptop, LogOut, Menu, PackageCheck, PanelLeftClose, PanelLeftOpen, Search, Settings, Users, X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import type { RoleName } from "@/lib/permissions";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, roles: null },
  { href: "/reports/pipeline", label: "Pipeline", icon: ClipboardList, roles: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"] as RoleName[] },
  { href: "/leads", label: "Leads", icon: BriefcaseBusiness, roles: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"] as RoleName[] },
  { href: "/customers", label: "Customers", icon: Users, roles: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN"] as RoleName[] },
  { href: "/products", label: "Products", icon: Laptop, roles: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN"] as RoleName[] },
  { href: "/quotes", label: "Quotes", icon: FileText, roles: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"] as RoleName[] },
  { href: "/orders", label: "Orders", icon: Boxes, roles: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "DISPATCH", "SERVICE_AGENT"] as RoleName[] },
  { href: "/service", label: "Service", icon: Headset, roles: ["ADMIN", "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN"] as RoleName[] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["ADMIN"] as RoleName[] },
  { href: "/crm-setup", label: "CRM Setup", icon: Database, roles: ["ADMIN"] as RoleName[] },
];

type NavObject = { id: string; apiName: string; pluralLabel: string; objectType: string; active: boolean };
type CrmApp = { id: string; key: string; name: string; icon: string; isDefault: boolean; defaultObjectId: string | null; assignments: { objectId: string; navigationOrder: number; label: string | null; object: NavObject }[] };

export function AppShell({
  user,
  children,
  previewMode = false,
  readableObjectIds = [],
  apps = [],
}: {
  user: { name: string; email: string; role: RoleName };
  children: React.ReactNode;
  previewMode?: boolean;
  readableObjectIds?: string[];
  apps?: CrmApp[];
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedAppId, setSelectedAppId] = useState(apps.find((app) => app.isDefault)?.id || apps[0]?.id || "");
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    if (previewMode) {
      await fetch("/api/preview/logout", { method: "POST" });
    } else {
      await authClient.signOut();
    }
    router.replace("/login");
    router.refresh();
  }

  const selectedApp = apps.find((app) => app.id === selectedAppId) || apps.find((app) => app.isDefault) || apps[0];
  const objectLinks = useMemo(() => {
    if (!selectedApp || !apps.length) return [];
    const seen = new Set<string>();
    return [...selectedApp.assignments].sort((a, b) => a.navigationOrder - b.navigationOrder).flatMap((assignment) => {
      const object = assignment.object;
      if (!object.active || (!previewMode && !readableObjectIds.includes(object.id))) return [];
      const href = object.objectType === "CUSTOM" ? `/custom/${object.id}` : `/records/${object.id}`;
      if (seen.has(href)) return [];
      seen.add(href);
      return [{ href, label: assignment.label || object.pluralLabel, icon: Database }];
    });
  }, [selectedApp, apps.length, readableObjectIds, previewMode]);
  const globalLinks = navigation.filter((item) => ["/dashboard", "/reports/pipeline", "/settings", "/crm-setup"].includes(item.href) && (previewMode || !item.roles || item.roles.includes(user.role)));
  const fallbackLinks = navigation.filter((item) => previewMode || !item.roles || item.roles.includes(user.role));
  const renderedLinks = previewMode ? fallbackLinks : [...globalLinks.slice(0, 1), ...objectLinks, ...globalLinks.slice(1)];
  const sidebar = (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" onClick={() => setMobileOpen(false)}>
        <span className="brand-mark">G</span>
        <span><strong>GemNava CRM</strong><small>Customer operations</small></span>
      </Link>
      <div className="nav-caption">{selectedApp?.name || "APPLICATION"}</div>
      <nav aria-label="Main navigation">
        {renderedLinks.map(({ href, label, icon: Icon }) => (
          <Link
            href={href}
            key={href}
            onClick={() => setMobileOpen(false)}
            className={`nav-link ${pathname === href ? "active" : ""}`}
            aria-current={pathname === href ? "page" : undefined}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
        <div className="user-summary"><strong>{user.name}</strong><small>{user.role.replaceAll("_", " ")}</small></div>
        <button className="icon-button sidebar-signout" aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button>
      </div>
    </aside>
  );

  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <div className="desktop-sidebar">{sidebar}</div>
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className={`mobile-sidebar ${mobileOpen ? "open" : ""}`}>
        <button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        {sidebar}
      </div>
      <main className="main-area">
        {previewMode && <div className="preview-banner"><strong>Local preview</strong><span>Sample UI only · Changes save in this browser · No database connected</span></div>}
        <header className="topbar">
          <button className="icon-button desktop-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          {apps.length > 1 && <label className="application-switcher"><span className="sr-only">Application</span><select aria-label="Active application" value={selectedApp?.id || ""} onChange={(event) => {
            const app = apps.find((item) => item.id === event.target.value);
            setSelectedAppId(event.target.value);
            const landing = app?.assignments.find((item) => item.objectId === app.defaultObjectId && readableObjectIds.includes(item.objectId));
            if (landing) router.push(landing.object.objectType === "CUSTOM" ? `/custom/${landing.objectId}` : `/records/${landing.objectId}`);
            else router.push("/dashboard");
          }}>{apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>}
          {!previewMode ? <form className="global-search" action="/search">
            <Search size={17} aria-hidden="true" />
            <input name="q" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers, leads, orders…" aria-label="Global search" />
            <kbd>Enter</kbd>
          </form> : <div className="preview-search-note">Search from any module list</div>}
          <div className="topbar-user">
            <span className="online-dot" />
            <span>{previewMode ? "Preview Admin" : user.name}</span>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="header-action">{action}</div>}
    </div>
  );
}

export function StatusBadge({ children }: { children: string }) {
  const statusClass = children.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  return <span className={`status-badge status-${statusClass}`}>{children.replaceAll("_", " ")}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-icon"><ClipboardList size={23} /></div><strong>{title}</strong><p>{description}</p></div>;
}

export function LoadingIndicator() {
  return <div className="loading-indicator"><PackageCheck size={18} /> Loading records…</div>;
}
