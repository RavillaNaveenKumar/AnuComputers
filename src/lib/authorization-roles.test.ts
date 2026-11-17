import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm-app-access", () => ({
  getCrmFieldCapabilities: vi.fn(),
  getCrmObjectCapabilities: vi.fn(),
  hasCrmAppObjectAccess: vi.fn(),
  hasCrmObjectPermission: vi.fn(),
}));
vi.mock("@/lib/permissions", async () => import("./permissions"));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getSessionUserState: vi.fn() }));

import { evaluateUserAuthorization } from "./authorization";
import type { Capability, RoleName } from "./permissions";

const userFor = (role: RoleName) => ({
  id: `user-${role.toLowerCase()}`,
  name: role,
  email: `${role.toLowerCase()}@example.test`,
  role,
  profileId: "profile-1",
  active: true,
  mustChangePassword: false,
  preview: false,
});

async function permits(role: RoleName, capability: Capability) {
  const result = await evaluateUserAuthorization(userFor(role), { capability });
  return result.allowed;
}

describe("role authorization matrix", () => {
  it("limits a Sales Executive to sales work without assignment or service access", async () => {
    await expect(permits("SALES_EXECUTIVE", "quotes:write")).resolves.toBe(true);
    await expect(permits("SALES_EXECUTIVE", "leads:assign")).resolves.toBe(false);
    await expect(permits("SALES_EXECUTIVE", "service:write")).resolves.toBe(false);
  });

  it("allows a Sales Manager to assign leads without dispatch or service access", async () => {
    await expect(permits("SALES_MANAGER", "leads:assign")).resolves.toBe(true);
    await expect(permits("SALES_MANAGER", "orders:write")).resolves.toBe(true);
    await expect(permits("SALES_MANAGER", "dispatch:write")).resolves.toBe(false);
    await expect(permits("SALES_MANAGER", "service:assign")).resolves.toBe(false);
  });

  it("allows a Service Agent to manage service work but not sales or dispatch", async () => {
    await expect(permits("SERVICE_AGENT", "service:assign")).resolves.toBe(true);
    await expect(permits("SERVICE_AGENT", "customers:read")).resolves.toBe(true);
    await expect(permits("SERVICE_AGENT", "quotes:read")).resolves.toBe(false);
    await expect(permits("SERVICE_AGENT", "dispatch:write")).resolves.toBe(false);
  });

  it("keeps Technician assignment and sales management restricted", async () => {
    await expect(permits("TECHNICIAN", "service:write")).resolves.toBe(true);
    await expect(permits("TECHNICIAN", "service:assign")).resolves.toBe(false);
    await expect(permits("TECHNICIAN", "leads:write")).resolves.toBe(false);
    await expect(permits("TECHNICIAN", "orders:read")).resolves.toBe(false);
  });

  it("grants the Administrator the full server-side capability set", async () => {
    await expect(permits("ADMIN", "settings:manage")).resolves.toBe(true);
    await expect(permits("ADMIN", "staff:manage")).resolves.toBe(true);
    await expect(permits("ADMIN", "dispatch:write")).resolves.toBe(true);
    await expect(permits("ADMIN", "service:assign")).resolves.toBe(true);
  });
});
