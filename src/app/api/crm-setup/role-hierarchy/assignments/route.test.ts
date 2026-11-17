import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCrmAdmin: vi.fn(),
  auditCrmChange: vi.fn(),
  findUser: vi.fn(),
  findRole: vi.fn(),
  updateUser: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    crmHierarchyRole: { findUnique: mocks.findRole },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/crm-setup-api", () => ({
  requireCrmAdmin: mocks.requireCrmAdmin,
  auditCrmChange: mocks.auditCrmChange,
}));

import { PUT } from "./route";

describe("PUT /api/crm-setup/role-hierarchy/assignments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireCrmAdmin.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.findUser.mockResolvedValue({ id: "user-1", hierarchyRoleId: "old-role" });
    mocks.findRole.mockResolvedValue({ id: "new-role", name: "Sales Manager" });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({ user: { update: mocks.updateUser } } as never),
    );
  });

  it("denies non-admin requests before reading or changing assignments", async () => {
    mocks.requireCrmAdmin.mockResolvedValue({ response: new Response("denied", { status: 403 }) });

    const response = await PUT(new Request("http://localhost/api/crm-setup/role-hierarchy/assignments", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-1", hierarchyRoleId: "new-role" }),
    }));
    if (!response) throw new Error("Expected an HTTP response.");

    expect(response.status).toBe(403);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("persists the hierarchy assignment and audits it in the same transaction", async () => {
    const response = await PUT(new Request("http://localhost/api/crm-setup/role-hierarchy/assignments", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-1", hierarchyRoleId: "new-role" }),
    }));
    if (!response) throw new Error("Expected an HTTP response.");

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { hierarchyRoleId: "new-role" },
    });
    expect(mocks.auditCrmChange).toHaveBeenCalledWith(
      expect.objectContaining({ user: { update: mocks.updateUser } }),
      "admin-1",
      "USER_HIERARCHY_ROLE_UPDATED",
      "User",
      "user-1",
      {
        previousRoleId: "old-role",
        hierarchyRoleId: "new-role",
        hierarchyRoleName: "Sales Manager",
      },
    );
    await expect(response.json()).resolves.toEqual({ success: true, hierarchyRoleId: "new-role" });
  });
});
