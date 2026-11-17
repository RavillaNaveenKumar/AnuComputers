import type { CrmObjectDefaultAccess, CrmRecordShareAccess, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateCrmRecordAccess, permitsRecordOperation } from "@/lib/crm-record-sharing";

type SharingUser = { id: string; role: string; profileId?: string | null };
type SharingRecord = { id: string; ownerId: string | null; data: Prisma.JsonValue; legacyAccess?: boolean };
export type RecordOperation = "read" | "edit";
type RecordAccessOptions = {
  storage?: "registry" | "native";
  loadNativeParents?: (objectId: string, recordIds: string[]) => Promise<{ records: SharingRecord[]; native: boolean }>;
};

const accessLevel = (access: CrmRecordShareAccess): "READ" | "EDIT" => access;

async function hasViewAll(user: SharingUser, objectId: string, operation: RecordOperation) {
  if (user.role === "ADMIN") return true;
  const profileId = user.profileId || (await prisma.user.findUnique({
    where: { id: user.id },
    select: { profileId: true },
  }))?.profileId;
  if (!profileId) return false;
  const [profileGrant, permissionSetGrant] = await Promise.all([
    prisma.crmProfileObjectPermission.findUnique({
      where: { profileId_objectId: { profileId, objectId } },
      select: { viewAll: true, modifyAll: true },
    }),
    prisma.crmPermissionSetObjectPermission.findFirst({
      where: {
        objectId,
        permissionSet: { assignments: { some: { userId: user.id } } },
        OR: operation === "read" ? [{ viewAll: true }, { modifyAll: true }] : [{ modifyAll: true }],
      },
      select: { id: true },
    }),
  ]);
  return Boolean(profileGrant?.modifyAll || (operation === "read" && profileGrant?.viewAll) || permissionSetGrant);
}

export async function filterAccessibleCrmRecords(
  user: SharingUser,
  objectId: string,
  records: SharingRecord[],
  operation: RecordOperation,
  visitedObjects = new Set<string>(),
  options: RecordAccessOptions = {},
): Promise<SharingRecord[]> {
  if (!records.length) return [];
  if (user.role === "ADMIN" || visitedObjects.has(objectId)) return user.role === "ADMIN" ? records : [];
  if (await hasViewAll(user, objectId, operation)) return records;

  const [config, rules] = await Promise.all([
    prisma.crmSharingConfig.findUnique({
      where: { objectId },
      include: { parentRelationship: { include: { field: { select: { apiName: true } } } } },
    }),
    prisma.crmSharingRule.findMany({
      where: { objectId, active: true },
      select: {
        ruleType: true,
        sourceHierarchyRoleId: true,
        sourceIncludesSubordinates: true,
        criteria: true,
        targetUserId: true,
        targetHierarchyRoleId: true,
        targetIncludesSubordinates: true,
        access: true,
      },
    }),
  ]);
  const defaultAccess: CrmObjectDefaultAccess = config?.defaultAccess ?? "PUBLIC_READ_WRITE";
  const isPublicForAllRecords = records.every((record) => record.legacyAccess !== false);
  if (isPublicForAllRecords && ((defaultAccess === "PUBLIC_READ_WRITE") || (defaultAccess === "PUBLIC_READ_ONLY" && operation === "read"))) {
    return records;
  }

  const recordIds = records.map(({ id }) => id);
  const ownerIds = [...new Set(records.flatMap(({ ownerId }) => ownerId ? [ownerId] : []))];
  const [hierarchyRoles, viewer, owners, shares] = await Promise.all([
    prisma.crmHierarchyRole.findMany({ select: { id: true, parentId: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { hierarchyRoleId: true } }),
    ownerIds.length
      ? prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, hierarchyRoleId: true } })
      : Promise.resolve([]),
    options.storage === "native"
      ? prisma.crmNativeRecordShare.findMany({
        where: { objectId, recordId: { in: recordIds }, userId: user.id },
        select: { recordId: true, access: true },
      })
      : prisma.crmRecordShare.findMany({
        where: { recordId: { in: recordIds }, userId: user.id },
        select: { recordId: true, access: true },
      }),
  ]);
  const parentByRoleId = new Map(hierarchyRoles.map(({ id, parentId }) => [id, parentId]));
  const ownerRoleByUserId = new Map(owners.map(({ id, hierarchyRoleId }) => [id, hierarchyRoleId]));
  const shareByRecordId = new Map(shares.map(({ recordId, access }) => [recordId, accessLevel(access)]));
  const visible = new Set<string>();

  let parentAccessibleIds = new Set<string>();
  const parentRelationship = config?.parentRelationship;
  if (defaultAccess === "CONTROLLED_BY_PARENT" && parentRelationship?.field) {
    const parentObjectId = parentRelationship.targetObjectId;
    const parentIds = [...new Set(records.flatMap((record) => {
      const value = (record.data as Record<string, unknown>)[parentRelationship.field!.apiName];
      return typeof value === "string" && value ? [value] : [];
    }))];
    if (parentIds.length) {
      const nextVisited = new Set(visitedObjects);
      nextVisited.add(objectId);
      const loadedNativeParents = options.loadNativeParents
        ? await options.loadNativeParents(parentObjectId, parentIds)
        : null;
      const parentRecords = loadedNativeParents?.records ?? await prisma.crmRecord.findMany({
        where: { objectId: parentObjectId, id: { in: parentIds } },
        select: { id: true, ownerId: true, data: true },
      });
      const accessibleParents = await filterAccessibleCrmRecords(
        user,
        parentObjectId,
        parentRecords,
        operation,
        nextVisited,
        loadedNativeParents?.native ? options : {},
      );
      parentAccessibleIds = new Set(accessibleParents.map(({ id }) => id));
    }
  }

  for (const record of records) {
    const ownerRoleId = record.ownerId ? ownerRoleByUserId.get(record.ownerId) ?? null : null;
    const parentId = parentRelationship?.field
      ? (record.data as Record<string, unknown>)[parentRelationship.field.apiName]
      : null;
    const parentAccess = typeof parentId === "string" && parentAccessibleIds.has(parentId)
      ? (operation === "edit" ? "EDIT" : "READ")
      : "NONE";
    const access = calculateCrmRecordAccess({
      userId: user.id,
      ownerId: record.ownerId,
      legacyAccess: record.legacyAccess,
      viewerRoleId: viewer?.hierarchyRoleId ?? null,
      ownerRoleId,
      parentByRoleId,
      defaultAccess: record.legacyAccess === false ? "PRIVATE" : defaultAccess,
      grantAccessUsingHierarchy: config?.grantAccessUsingHierarchy ?? false,
      manualShare: shareByRecordId.get(record.id) ?? null,
      rules,
      data: record.data,
      parentAccess,
    });
    if (permitsRecordOperation(access, operation)) visible.add(record.id);
  }

  return records.filter(({ id }) => visible.has(id));
}
