import { describe, expect, it } from "vitest";
import {
  calculateCrmRecordAccess,
  matchesSharingCriteria,
  permitsRecordOperation,
  roleIsInScope,
  strongestRecordShare,
} from "./crm-record-sharing";

describe("record sharing policies", () => {
  it("recognizes only self and configured descendants in a hierarchy scope", () => {
    const parents = new Map([
      ["ce-1", "sales-manager"],
      ["sales-manager", "company"],
      ["company", null],
      ["service-agent", "service-manager"],
      ["service-manager", "company"],
    ]);

    expect(roleIsInScope("sales-manager", "sales-manager", false, parents)).toBe(true);
    expect(roleIsInScope("ce-1", "sales-manager", true, parents)).toBe(true);
    expect(roleIsInScope("ce-1", "sales-manager", false, parents)).toBe(false);
    expect(roleIsInScope("service-agent", "sales-manager", true, parents)).toBe(false);
    expect(roleIsInScope(null, "sales-manager", true, parents)).toBe(false);
  });

  it("fails closed for malformed criteria and supports AND/OR predicates", () => {
    const data = { Region: "West", Active: true, Notes: null };
    expect(matchesSharingCriteria(data, {
      operator: "AND",
      conditions: [
        { field: "Region", operator: "EQUALS", value: "West" },
        { field: "Active", operator: "EQUALS", value: true },
      ],
    })).toBe(true);
    expect(matchesSharingCriteria(data, {
      operator: "OR",
      conditions: [
        { field: "Region", operator: "EQUALS", value: "East" },
        { field: "Notes", operator: "IS_NULL" },
      ],
    })).toBe(true);
    expect(matchesSharingCriteria(data, {
      operator: "AND",
      conditions: [{ field: "Region", operator: "CONTAINS", value: 5 }],
    })).toBe(false);
    expect(matchesSharingCriteria(data, {
      operator: "XOR",
      conditions: [{ field: "Region", operator: "EQUALS", value: "West" }],
    })).toBe(false);
  });

  it("combines grants monotonically and keeps read shares from granting edits", () => {
    expect(strongestRecordShare("NONE", "READ", "EDIT")).toBe("EDIT");
    expect(strongestRecordShare("NONE", "READ")).toBe("READ");
    expect(permitsRecordOperation("READ", "read")).toBe(true);
    expect(permitsRecordOperation("READ", "edit")).toBe(false);
    expect(permitsRecordOperation("NONE", "read")).toBe(false);
  });

  it("applies manual user shares without granting more than the configured access", () => {
    const record = {
      userId: "shared-user",
      ownerId: "owner",
      viewerRoleId: null,
      ownerRoleId: null,
      parentByRoleId: new Map<string, string | null>(),
      defaultAccess: "PRIVATE" as const,
      grantAccessUsingHierarchy: false,
      manualShare: "READ" as const,
      rules: [],
      data: {},
      parentAccess: "NONE" as const,
    };

    const access = calculateCrmRecordAccess(record);
    expect(access).toBe("READ");
    expect(permitsRecordOperation(access, "read")).toBe(true);
    expect(permitsRecordOperation(access, "edit")).toBe(false);
    expect(calculateCrmRecordAccess({ ...record, manualShare: "EDIT" })).toBe("EDIT");
  });

  it("grants private records to their owner and configured hierarchy managers only", () => {
    const parents = new Map([
      ["seller", "sales-manager"],
      ["sales-manager", "company"],
      ["company", null],
    ]);
    const record = {
      userId: "manager",
      ownerId: "seller",
      viewerRoleId: "sales-manager",
      ownerRoleId: "seller",
      parentByRoleId: parents,
      defaultAccess: "PRIVATE" as const,
      grantAccessUsingHierarchy: true,
      manualShare: null,
      rules: [],
      data: {},
      parentAccess: "NONE" as const,
    };

    expect(calculateCrmRecordAccess(record)).toBe("EDIT");
    expect(calculateCrmRecordAccess({ ...record, grantAccessUsingHierarchy: false })).toBe("NONE");
    expect(calculateCrmRecordAccess({ ...record, userId: "seller" })).toBe("EDIT");
  });

  it("preserves explicitly retained legacy access when native defaults are constrained", () => {
    const record = {
      userId: "assigned-agent",
      ownerId: null,
      viewerRoleId: null,
      ownerRoleId: null,
      parentByRoleId: new Map<string, string | null>(),
      defaultAccess: "PRIVATE" as const,
      grantAccessUsingHierarchy: false,
      manualShare: null,
      rules: [],
      data: {},
      parentAccess: "NONE" as const,
    };

    expect(calculateCrmRecordAccess({ ...record, legacyAccess: true })).toBe("EDIT");
    expect(calculateCrmRecordAccess({ ...record, legacyAccess: false })).toBe("NONE");
  });

  it("applies owner-based and criteria rules only to matching recipients and records", () => {
    const parents = new Map([
      ["seller", "sales-manager"],
      ["sales-manager", "company"],
      ["service-agent", "service-manager"],
      ["service-manager", "company"],
      ["company", null],
    ]);
    const ruleContext = {
      userId: "agent",
      ownerId: "seller-user",
      viewerRoleId: "service-agent",
      ownerRoleId: "seller",
      parentByRoleId: parents,
      defaultAccess: "PRIVATE" as const,
      grantAccessUsingHierarchy: false,
      manualShare: null,
      data: { Status: "QUALIFIED" },
      parentAccess: "NONE" as const,
    };
    const ownerRule = {
      ruleType: "OWNER" as const,
      sourceHierarchyRoleId: "sales-manager",
      sourceIncludesSubordinates: true,
      criteria: null,
      targetUserId: null,
      targetHierarchyRoleId: "service-manager",
      targetIncludesSubordinates: true,
      access: "READ" as const,
    };
    expect(calculateCrmRecordAccess({ ...ruleContext, rules: [ownerRule] })).toBe("READ");
    expect(calculateCrmRecordAccess({
      ...ruleContext,
      viewerRoleId: "service-agent",
      rules: [{ ...ownerRule, targetIncludesSubordinates: false }],
    })).toBe("NONE");

    const criteriaRule = {
      ruleType: "CRITERIA" as const,
      sourceHierarchyRoleId: null,
      sourceIncludesSubordinates: false,
      criteria: { operator: "AND", conditions: [{ field: "Status", operator: "EQUALS", value: "QUALIFIED" }] },
      targetUserId: "agent",
      targetHierarchyRoleId: null,
      targetIncludesSubordinates: false,
      access: "EDIT" as const,
    };
    expect(calculateCrmRecordAccess({ ...ruleContext, rules: [criteriaRule] })).toBe("EDIT");
    expect(calculateCrmRecordAccess({
      ...ruleContext,
      data: { Status: "NEW" },
      rules: [criteriaRule],
    })).toBe("NONE");
  });

  it("inherits parent access and respects read-only object defaults", () => {
    const common = {
      userId: "viewer",
      ownerId: "owner",
      viewerRoleId: null,
      ownerRoleId: null,
      parentByRoleId: new Map<string, string | null>(),
      grantAccessUsingHierarchy: false,
      manualShare: null,
      rules: [],
      data: {},
    };
    expect(calculateCrmRecordAccess({
      ...common,
      defaultAccess: "CONTROLLED_BY_PARENT",
      parentAccess: "READ",
    })).toBe("READ");
    expect(calculateCrmRecordAccess({
      ...common,
      defaultAccess: "PUBLIC_READ_ONLY",
      parentAccess: "NONE",
    })).toBe("READ");
    expect(calculateCrmRecordAccess({
      ...common,
      defaultAccess: "PUBLIC_READ_ONLY",
      parentAccess: "NONE",
    })).not.toBe("EDIT");
  });
});
