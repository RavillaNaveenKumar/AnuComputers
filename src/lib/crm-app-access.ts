import { prisma } from "@/lib/prisma";
import {
  isTabVisible,
  resolveEffectiveFieldCapabilities,
  resolveEffectiveObjectCapabilities,
} from "@/lib/crm-profile-permissions";
export {
  isTabVisible,
  resolveEffectiveFieldCapabilities,
  resolveEffectiveObjectCapabilities,
  resolveFieldCapabilities,
  resolveObjectCapabilities,
} from "@/lib/crm-profile-permissions";

type UserAccess = { id: string; role: string; profileId?: string | null };
export type ObjectCapability = "canCreate" | "canRead" | "canEdit" | "canDelete";

async function profileIdFor(user: UserAccess) {
  if (user.profileId) return user.profileId;
  const record = await prisma.user.findUnique({ where: { id: user.id }, select: { profileId: true } });
  return record?.profileId ?? null;
}

export async function hasCrmAppObjectAccess(user: UserAccess, objectId: string) {
  if (user.role === "ADMIN") return true;
  const profileId = await profileIdFor(user);
  if (!profileId) return false;
  const [profilePermission, permissionSetPermission] = await Promise.all([
    prisma.crmProfileAppPermission.findFirst({
      where: {
        profileId,
        canAccess: true,
        app: {
          active: true,
          assignments: { some: { objectId, active: true, object: { active: true } } },
        },
      },
      select: { id: true },
    }),
    prisma.crmPermissionSetAppPermission.findFirst({
      where: {
        canAccess: true,
        permissionSet: { assignments: { some: { userId: user.id } } },
        app: {
          active: true,
          assignments: { some: { objectId, active: true, object: { active: true } } },
        },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(profilePermission || permissionSetPermission);
}

export async function getCrmObjectCapabilities(user: UserAccess, objectId: string) {
  if (user.role === "ADMIN") return { canCreate: true, canRead: true, canEdit: true, canDelete: true };
  const profileId = await profileIdFor(user);
  if (!profileId) return { canCreate: false, canRead: false, canEdit: false, canDelete: false };
  const [profilePermission, permissionSetGrants] = await Promise.all([
    prisma.crmProfileObjectPermission.findUnique({
      where: { profileId_objectId: { profileId, objectId } },
      select: { canCreate: true, canRead: true, canEdit: true, canDelete: true, viewAll: true, modifyAll: true },
    }),
    prisma.crmPermissionSetObjectPermission.findMany({
      where: { objectId, permissionSet: { assignments: { some: { userId: user.id } } } },
      select: { canCreate: true, canRead: true, canEdit: true, canDelete: true, viewAll: true, modifyAll: true },
    }),
  ]);
  return resolveEffectiveObjectCapabilities(profilePermission, permissionSetGrants);
}

export async function hasCrmObjectPermission(user: UserAccess, apiName: string, capability: ObjectCapability) {
  if (user.role === "ADMIN") return true;
  const object = await prisma.crmObject.findFirst({
    where: { apiName, active: true },
    select: { id: true },
  });
  if (!object || !await hasCrmAppObjectAccess(user, object.id)) return false;
  const capabilities = await getCrmObjectCapabilities(user, object.id);
  return capabilities[capability];
}

export async function getCrmFieldCapabilities(user: UserAccess, objectId: string, fieldIds: string[]) {
  const fields = await prisma.crmField.findMany({
    where: { objectId, id: { in: fieldIds } },
    select: { id: true, dataType: true, origin: true, readOnly: true },
  });
  const readOnlyFields = new Set(fields
    .filter(({ dataType, origin, readOnly }) => dataType === "AUTO_NUMBER" || readOnly || origin === "SYSTEM")
    .map(({ id }) => id));
  if (user.role === "ADMIN") {
    return new Map(fieldIds.map((id) => [id, { canRead: true, canEdit: !readOnlyFields.has(id) }]));
  }
  const profileId = await profileIdFor(user);
  if (!profileId) return new Map(fieldIds.map((id) => [id, { canRead: false, canEdit: false }]));
  const [profileGrants, permissionSetGrants] = await Promise.all([
    prisma.crmProfileFieldPermission.findMany({
      where: { profileId, fieldId: { in: fieldIds }, field: { objectId } },
      select: { fieldId: true, visible: true, editable: true },
    }),
    prisma.crmPermissionSetFieldPermission.findMany({
      where: { fieldId: { in: fieldIds }, field: { objectId }, permissionSet: { assignments: { some: { userId: user.id } } } },
      select: { fieldId: true, canRead: true, canEdit: true },
    }),
  ]);
  const profileByFieldId = new Map(profileGrants.map(({ fieldId, ...permission }) => [fieldId, permission]));
  const permissionSetsByFieldId = new Map<string, { canRead: boolean; canEdit: boolean }[]>();
  for (const { fieldId, canRead, canEdit } of permissionSetGrants) {
    permissionSetsByFieldId.set(fieldId, [...(permissionSetsByFieldId.get(fieldId) ?? []), { canRead, canEdit }]);
  }
  return new Map(fieldIds.map((id) => [
    id,
    resolveEffectiveFieldCapabilities(profileByFieldId.get(id) ?? null, permissionSetsByFieldId.get(id) ?? [], readOnlyFields.has(id)),
  ]));
}

export async function getAppsForUser(user: UserAccess) {
  const where = { active: true };
  if (user.role === "ADMIN") {
    return prisma.crmApp.findMany({
      where,
      include: { assignments: { where: { active: true, object: { active: true } }, include: { object: true }, orderBy: { navigationOrder: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }
  const profileId = await profileIdFor(user);
  if (!profileId) return [];
  const [profile, permissionSetAssignments] = await Promise.all([
    prisma.crmProfile.findUnique({
      where: { id: profileId },
      select: {
        appPermissions: { where: { canAccess: true }, select: { appId: true } },
        objectPermissions: {
          where: { OR: [{ canRead: true }, { viewAll: true }, { modifyAll: true }] },
          select: { objectId: true },
        },
        tabPermissions: { select: { appId: true, objectId: true, visibility: true } },
      },
    }),
    prisma.crmPermissionSetAssignment.findMany({
      where: { userId: user.id },
      select: {
        permissionSet: {
          select: {
            appPermissions: { where: { canAccess: true }, select: { appId: true } },
            objectPermissions: {
              where: { OR: [{ canRead: true }, { viewAll: true }, { modifyAll: true }] },
              select: { objectId: true },
            },
            tabPermissions: { select: { appId: true, objectId: true, visibility: true } },
          },
        },
      },
    }),
  ]);
  if (!profile) return [];
  const appIds = new Set([
    ...profile.appPermissions.map(({ appId }) => appId),
    ...permissionSetAssignments.flatMap(({ permissionSet }) => permissionSet.appPermissions.map(({ appId }) => appId)),
  ]);
  const readableObjects = new Set([
    ...profile.objectPermissions.map(({ objectId }) => objectId),
    ...permissionSetAssignments.flatMap(({ permissionSet }) => permissionSet.objectPermissions.map(({ objectId }) => objectId)),
  ]);
  const tabVisibility = new Map(profile.tabPermissions.map(({ appId, objectId, visibility }) => [`${appId}:${objectId}`, visibility]));
  const permissionSetTabs = new Map<string, string[]>();
  for (const { permissionSet } of permissionSetAssignments) {
    for (const { appId, objectId, visibility } of permissionSet.tabPermissions) {
      permissionSetTabs.set(`${appId}:${objectId}`, [...(permissionSetTabs.get(`${appId}:${objectId}`) ?? []), visibility]);
    }
  }
  const apps = await prisma.crmApp.findMany({
    where: { ...where, id: { in: [...appIds] } },
    include: {
      assignments: {
        where: { active: true, object: { active: true } },
        include: { object: true },
        orderBy: { navigationOrder: "asc" },
      },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return apps.map((app) => ({
    ...app,
    assignments: app.assignments.filter(({ objectId }) =>
      readableObjects.has(objectId) && isTabVisible(
        tabVisibility.get(`${app.id}:${objectId}`) ?? "DEFAULT_ON",
        permissionSetTabs.get(`${app.id}:${objectId}`) ?? [],
      )),
  }));
}

export async function getReadableObjectIds(user: UserAccess) {
  if (user.role === "ADMIN") {
    return (await prisma.crmObject.findMany({ where: { active: true }, select: { id: true } })).map(({ id }) => id);
  }
  const profileId = await profileIdFor(user);
  if (!profileId) return [];
  const [profileGrants, permissionSetGrants] = await Promise.all([
    prisma.crmProfileObjectPermission.findMany({
      where: { profileId, OR: [{ canRead: true }, { viewAll: true }, { modifyAll: true }], object: { active: true } },
      select: { objectId: true },
    }),
    prisma.crmPermissionSetObjectPermission.findMany({
      where: {
        OR: [{ canRead: true }, { viewAll: true }, { modifyAll: true }],
        object: { active: true },
        permissionSet: { assignments: { some: { userId: user.id } } },
      },
      select: { objectId: true },
    }),
  ]);
  return [...new Set([...profileGrants, ...permissionSetGrants].map(({ objectId }) => objectId))];
}
