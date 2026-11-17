import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm-app-access", () => ({
  getCrmFieldCapabilities: vi.fn(),
  getCrmObjectCapabilities: vi.fn(),
  hasCrmAppObjectAccess: vi.fn(),
  hasCrmObjectPermission: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSessionUserState: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { crmObject: { findFirst: vi.fn() } } }));

import { getCrmFieldCapabilities, getCrmObjectCapabilities, hasCrmAppObjectAccess, hasCrmObjectPermission } from "@/lib/crm-app-access";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { getSessionUserState } from "@/lib/session";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "./authorization";

const user = {
  id: "user-1",
  name: "Sales User",
  email: "sales@example.test",
  role: "SALES_EXECUTIVE" as const,
  profileId: "profile-1",
  active: true,
  mustChangePassword: false,
  preview: false,
};

describe("evaluateAuthorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when there is no authenticated session", async () => {
    vi.mocked(getSessionUserState).mockResolvedValue({ kind: "unauthenticated" });

    await expect(evaluateAuthorization()).resolves.toEqual({
      allowed: false,
      status: 401,
      error: "Sign in is required.",
    });
  });

  it("returns 403 for an authenticated account that is inactive or login-blocked", async () => {
    vi.mocked(getSessionUserState).mockResolvedValue({ kind: "denied" });

    await expect(evaluateAuthorization()).resolves.toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it("requires the object permission and requested capability", async () => {
    vi.mocked(getSessionUserState).mockResolvedValue({ kind: "authenticated", user });
    vi.mocked(can).mockReturnValue(false);

    const denied = await evaluateAuthorization({ capability: "leads:write" });
    expect(denied).toMatchObject({ allowed: false, status: 403 });

    vi.mocked(can).mockReturnValue(true);
    vi.mocked(hasCrmObjectPermission).mockResolvedValue(true);
    await expect(evaluateAuthorization({
      capability: "leads:write",
      objectApiName: "Lead",
      objectCapability: "canCreate",
    })).resolves.toMatchObject({ allowed: true, user });
    expect(hasCrmObjectPermission).toHaveBeenCalledWith(user, "Lead", "canCreate");
  });

  it("checks app availability and object grants for registry object ids", async () => {
    vi.mocked(getSessionUserState).mockResolvedValue({ kind: "authenticated", user });
    vi.mocked(hasCrmAppObjectAccess).mockResolvedValue(true);
    vi.mocked(getCrmObjectCapabilities).mockResolvedValue({
      canCreate: false,
      canRead: true,
      canEdit: false,
      canDelete: false,
    });

    await expect(evaluateAuthorization({ objectId: "object-1", objectCapability: "canRead" }))
      .resolves.toMatchObject({ allowed: true, user });
    await expect(evaluateAuthorization({ objectId: "object-1", objectCapability: "canEdit" }))
      .resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it("denies field access when any requested field is not permitted", async () => {
    vi.mocked(getSessionUserState).mockResolvedValue({ kind: "authenticated", user });
    vi.mocked(hasCrmAppObjectAccess).mockResolvedValue(true);
    vi.mocked(getCrmFieldCapabilities).mockResolvedValue(new Map([
      ["visible", { canRead: true, canEdit: true }],
      ["hidden", { canRead: false, canEdit: false }],
    ]));

    await expect(evaluateAuthorization({
      fieldAccess: { objectId: "object-1", fieldIds: ["visible", "hidden"], operation: "read" },
    })).resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it("applies field-level grants to named native fields", async () => {
    vi.mocked(prisma.crmObject.findFirst).mockResolvedValue({
      id: "object-1",
      fields: [{ id: "name-field", apiName: "Name" }],
    } as never);
    vi.mocked(hasCrmAppObjectAccess).mockResolvedValue(true);
    vi.mocked(getCrmFieldCapabilities).mockResolvedValue(new Map([
      ["name-field", { canRead: true, canEdit: false }],
    ]));

    await expect(evaluateNativeFieldAuthorization(user, "Account", ["Name"], "read"))
      .resolves.toMatchObject({ allowed: true });
    await expect(evaluateNativeFieldAuthorization(user, "Account", ["Name"], "edit"))
      .resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it("fails closed when a native API field has no active metadata mapping", async () => {
    vi.mocked(prisma.crmObject.findFirst).mockResolvedValue({
      id: "object-1",
      fields: [],
    } as never);

    await expect(evaluateNativeFieldAuthorization(user, "Account", ["UnmappedField"], "read"))
      .resolves.toMatchObject({ allowed: false, status: 403 });
    expect(hasCrmAppObjectAccess).not.toHaveBeenCalled();
  });
});
