export type RoleName = "ADMIN" | "SALES_MANAGER" | "SALES_EXECUTIVE" | "DISPATCH" | "SERVICE_MANAGER" | "SERVICE_AGENT" | "TECHNICIAN" | "PREVIEW";

export type Capability =
  | "customers:read"
  | "customers:write"
  | "products:read"
  | "products:write"
  | "leads:read"
  | "leads:write"
  | "leads:assign"
  | "quotes:read"
  | "quotes:write"
  | "orders:read"
  | "orders:write"
  | "dispatch:write"
  | "service:read"
  | "service:write"
  | "service:assign"
  | "staff:manage"
  | "settings:manage";

const permissions: Record<RoleName, ReadonlySet<Capability>> = {
  ADMIN: new Set([
    "customers:read", "customers:write", "products:read", "products:write", "leads:read",
    "leads:write", "leads:assign", "quotes:read", "quotes:write", "orders:read", "orders:write",
    "dispatch:write", "service:read", "service:write", "service:assign", "staff:manage", "settings:manage",
  ]),
  SALES_MANAGER: new Set([
    "customers:read", "customers:write", "products:read", "leads:read", "leads:write",
    "leads:assign", "quotes:read", "quotes:write", "orders:read", "orders:write",
  ]),
  SALES_EXECUTIVE: new Set([
    "customers:read", "customers:write", "products:read", "leads:read", "leads:write",
    "quotes:read", "quotes:write", "orders:read", "orders:write",
  ]),
  DISPATCH: new Set(["customers:read", "orders:read", "dispatch:write"]),
  SERVICE_MANAGER: new Set(["customers:read", "products:read", "orders:read", "service:read", "service:write", "service:assign"]),
  SERVICE_AGENT: new Set(["customers:read", "products:read", "orders:read", "service:read", "service:write", "service:assign"]),
  TECHNICIAN: new Set(["customers:read", "products:read", "service:read", "service:write"]),
  PREVIEW: new Set(),
};

export function isRoleName(role: string): role is RoleName {
  return role !== "PREVIEW" && role in permissions;
}

export function can(role: RoleName, capability: Capability): boolean {
  return permissions[role].has(capability);
}
