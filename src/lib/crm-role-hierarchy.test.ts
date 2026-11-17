import { describe, expect, it } from "vitest";
import { roleParentCreatesCycle } from "./crm-role-hierarchy";

describe("roleParentCreatesCycle", () => {
  it("allows a role to be nested below a different branch", () => {
    expect(roleParentCreatesCycle("rep", "sales-manager", new Map([
      ["sales-manager", "company"],
      ["company", null],
    ]))).toBe(false);
  });

  it("rejects self-parenting and assigning a descendant as parent", () => {
    const parents = new Map([
      ["sales-manager", "company"],
      ["rep", "sales-manager"],
      ["company", null],
    ]);
    expect(roleParentCreatesCycle("sales-manager", "sales-manager", parents)).toBe(true);
    expect(roleParentCreatesCycle("sales-manager", "rep", parents)).toBe(true);
  });

  it("fails closed when the existing parent chain already contains a cycle", () => {
    expect(roleParentCreatesCycle("new-role", "parent-a", new Map([
      ["parent-a", "parent-b"],
      ["parent-b", "parent-a"],
    ]))).toBe(true);
  });
});
