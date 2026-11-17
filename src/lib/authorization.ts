import {
  getCrmFieldCapabilities,
  getCrmObjectCapabilities,
  hasCrmAppObjectAccess,
  hasCrmObjectPermission,
  type ObjectCapability,
} from "@/lib/crm-app-access";
import { can, type Capability } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getSessionUserState } from "@/lib/session";
import type { AuthenticatedUser } from "@/lib/session";

export type AuthorizationRequirement = {
  capability?: Capability;
  objectApiName?: string;
  objectId?: string;
  objectCapability?: ObjectCapability;
  fieldAccess?: { objectId: string; fieldIds: string[]; operation: "read" | "edit" };
};

export type AuthorizationResult =
  | { allowed: true; user: AuthenticatedUser; fieldCapabilities?: Awaited<ReturnType<typeof getCrmFieldCapabilities>> }
  | { allowed: false; status: 401 | 403; error: string };

export async function evaluateAuthorization(requirement: AuthorizationRequirement = {}): Promise<AuthorizationResult> {
  const state = await getSessionUserState();
  if (state.kind === "unauthenticated") {
    return { allowed: false, status: 401, error: "Sign in is required." };
  }
  if (state.kind === "denied") {
    return { allowed: false, status: 403, error: "Your account is not permitted to access this resource." };
  }
  return evaluateUserAuthorization(state.user, requirement);
}

export async function evaluateUserAuthorization(
  user: AuthenticatedUser,
  requirement: AuthorizationRequirement = {},
): Promise<AuthorizationResult> {
  if (user.preview || user.mustChangePassword) {
    return { allowed: false, status: 403, error: "Your account is not permitted to access this resource." };
  }
  if (requirement.capability && !can(user.role, requirement.capability)) {
    return { allowed: false, status: 403, error: "You do not have permission to perform this action." };
  }
  if (requirement.objectApiName && requirement.objectId) {
    return { allowed: false, status: 403, error: "Specify either an object API name or object id, not both." };
  }
  if (requirement.objectApiName && requirement.objectCapability) {
    if (!await hasCrmObjectPermission(user, requirement.objectApiName, requirement.objectCapability)) {
      return { allowed: false, status: 403, error: "You do not have permission to access this object." };
    }
  } else if (requirement.objectId && requirement.objectCapability) {
    const appAccess = await hasCrmAppObjectAccess(user, requirement.objectId);
    const capabilities = appAccess ? await getCrmObjectCapabilities(user, requirement.objectId) : null;
    if (!capabilities?.[requirement.objectCapability]) {
      return { allowed: false, status: 403, error: "You do not have permission to access this object." };
    }
  } else if (requirement.objectApiName || requirement.objectId || requirement.objectCapability) {
    return { allowed: false, status: 403, error: "An object and object operation are both required." };
  }

  let fieldCapabilities: Awaited<ReturnType<typeof getCrmFieldCapabilities>> | undefined;
  if (requirement.fieldAccess) {
    const { objectId, fieldIds, operation } = requirement.fieldAccess;
    if (!await hasCrmAppObjectAccess(user, objectId)) {
      return { allowed: false, status: 403, error: "This object is not available in an app you can access." };
    }
    fieldCapabilities = await getCrmFieldCapabilities(user, objectId, fieldIds);
    const denied = fieldIds.some((fieldId) => {
      const field = fieldCapabilities?.get(fieldId);
      return operation === "read" ? !field?.canRead : !field?.canEdit;
    });
    if (denied) {
      return { allowed: false, status: 403, error: `You do not have ${operation} access to one or more fields.` };
    }
  }

  return { allowed: true, user, ...(fieldCapabilities ? { fieldCapabilities } : {}) };
}

export async function evaluateNativeFieldAuthorization(
  user: AuthenticatedUser,
  apiName: string,
  fieldApiNames: string[],
  operation: "read" | "edit",
): Promise<AuthorizationResult> {
  const requestedFields = [...new Set(fieldApiNames)];
  if (!requestedFields.length) return { allowed: true, user };
  const object = await prisma.crmObject.findFirst({
    where: { apiName, active: true },
    select: {
      id: true,
      fields: { where: { active: true, apiName: { in: requestedFields } }, select: { id: true, apiName: true } },
    },
  });
  if (!object || object.fields.length !== requestedFields.length) {
    return { allowed: false, status: 403, error: "One or more requested fields are not available." };
  }
  return evaluateUserAuthorization(user, {
    fieldAccess: { objectId: object.id, fieldIds: object.fields.map(({ id }) => id), operation },
  });
}

export async function evaluateNativeFieldAuthorizations(
  user: AuthenticatedUser,
  fieldsByObject: Record<string, string[]>,
  operation: "read" | "edit" = "read",
) {
  const results = await Promise.all(Object.entries(fieldsByObject).map(
    ([apiName, fieldApiNames]) => evaluateNativeFieldAuthorization(user, apiName, fieldApiNames, operation),
  ));
  const denied = results.find((result) => !result.allowed);
  return denied && !denied.allowed ? denied : { allowed: true as const, user };
}
