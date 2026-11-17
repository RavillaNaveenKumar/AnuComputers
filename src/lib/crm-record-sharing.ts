export type RecordShareLevel = "NONE" | "READ" | "EDIT";
export type RecordOperation = "read" | "edit";

type SharingCondition = {
  field: string;
  operator: "EQUALS" | "NOT_EQUALS" | "CONTAINS" | "IN" | "IS_NULL";
  value?: unknown;
};

export type SharingCriteria = {
  operator: "AND" | "OR";
  conditions: SharingCondition[];
};

export type SharingRuleGrant = {
  ruleType: "OWNER" | "CRITERIA";
  sourceHierarchyRoleId: string | null;
  sourceIncludesSubordinates: boolean;
  criteria: unknown;
  targetUserId: string | null;
  targetHierarchyRoleId: string | null;
  targetIncludesSubordinates: boolean;
  access: "READ" | "EDIT";
};

export function roleIsInScope(
  subjectRoleId: string | null,
  rootRoleId: string,
  includeSubordinates: boolean,
  parentByRoleId: ReadonlyMap<string, string | null>,
) {
  if (!subjectRoleId) return false;
  if (subjectRoleId === rootRoleId) return true;
  if (!includeSubordinates) return false;

  const visited = new Set<string>();
  let currentRoleId = subjectRoleId;
  while (currentRoleId && !visited.has(currentRoleId)) {
    visited.add(currentRoleId);
    currentRoleId = parentByRoleId.get(currentRoleId) ?? "";
    if (currentRoleId === rootRoleId) return true;
  }
  return false;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function matchesCondition(data: Record<string, unknown>, condition: SharingCondition) {
  if (!condition.field || !Object.hasOwn(data, condition.field)) return condition.operator === "IS_NULL" && data[condition.field] == null;
  const actual = data[condition.field];
  switch (condition.operator) {
    case "EQUALS":
      return isScalar(actual) && isScalar(condition.value) && actual === condition.value;
    case "NOT_EQUALS":
      return isScalar(actual) && isScalar(condition.value) && actual !== condition.value;
    case "CONTAINS":
      return typeof actual === "string" && typeof condition.value === "string" && actual.includes(condition.value);
    case "IN":
      return isScalar(actual) && Array.isArray(condition.value) && condition.value.some((value) => isScalar(value) && value === actual);
    case "IS_NULL":
      return actual === null || actual === undefined;
  }
}

export function matchesSharingCriteria(data: unknown, criteria: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data) ||
      typeof criteria !== "object" || criteria === null || Array.isArray(criteria)) return false;
  const group = criteria as Partial<SharingCriteria>;
  if ((group.operator !== "AND" && group.operator !== "OR") || !Array.isArray(group.conditions) || group.conditions.length === 0) return false;
  const conditions = group.conditions as SharingCondition[];
  if (conditions.some((condition) =>
    typeof condition !== "object" || condition === null || typeof condition.field !== "string" ||
    !["EQUALS", "NOT_EQUALS", "CONTAINS", "IN", "IS_NULL"].includes(condition.operator))) return false;
  const results = conditions.map((condition) => matchesCondition(data as Record<string, unknown>, condition));
  return group.operator === "AND" ? results.every(Boolean) : results.some(Boolean);
}

export function strongestRecordShare(...levels: RecordShareLevel[]): RecordShareLevel {
  if (levels.includes("EDIT")) return "EDIT";
  if (levels.includes("READ")) return "READ";
  return "NONE";
}

export function calculateCrmRecordAccess(input: {
  userId: string;
  ownerId: string | null;
  legacyAccess?: boolean;
  viewerRoleId: string | null;
  ownerRoleId: string | null;
  parentByRoleId: ReadonlyMap<string, string | null>;
  defaultAccess: "PRIVATE" | "PUBLIC_READ_ONLY" | "PUBLIC_READ_WRITE" | "CONTROLLED_BY_PARENT";
  grantAccessUsingHierarchy: boolean;
  manualShare: "READ" | "EDIT" | null;
  rules: SharingRuleGrant[];
  data: unknown;
  parentAccess: RecordShareLevel;
}): RecordShareLevel {
  const grants: RecordShareLevel[] = [];
  if (input.ownerId === input.userId) grants.push("EDIT");
  if (input.legacyAccess) grants.push("EDIT");
  if (input.manualShare) grants.push(input.manualShare);
  if (input.grantAccessUsingHierarchy && input.viewerRoleId && input.ownerRoleId &&
      roleIsInScope(input.ownerRoleId, input.viewerRoleId, true, input.parentByRoleId)) {
    grants.push("EDIT");
  }

  for (const rule of input.rules) {
    const recipientMatches = rule.targetUserId === input.userId ||
      Boolean(rule.targetHierarchyRoleId && roleIsInScope(
        input.viewerRoleId,
        rule.targetHierarchyRoleId,
        rule.targetIncludesSubordinates,
        input.parentByRoleId,
      ));
    if (!recipientMatches) continue;

    const sourceMatches = rule.ruleType === "OWNER"
      ? Boolean(rule.sourceHierarchyRoleId) && roleIsInScope(
        input.ownerRoleId,
        rule.sourceHierarchyRoleId!,
        rule.sourceIncludesSubordinates,
        input.parentByRoleId,
      )
      : matchesSharingCriteria(input.data, rule.criteria);
    if (sourceMatches) grants.push(rule.access);
  }

  if (input.defaultAccess === "PUBLIC_READ_WRITE") grants.push("EDIT");
  if (input.defaultAccess === "PUBLIC_READ_ONLY") grants.push("READ");
  if (input.defaultAccess === "CONTROLLED_BY_PARENT" && input.parentAccess !== "NONE") grants.push(input.parentAccess);
  return strongestRecordShare(...grants);
}

export function permitsRecordOperation(level: RecordShareLevel, operation: RecordOperation) {
  return level === "EDIT" || (level === "READ" && operation === "read");
}
