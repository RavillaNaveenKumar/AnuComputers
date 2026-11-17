import { NextResponse } from "next/server";
import { getCrmFieldCapabilities, getCrmObjectCapabilities, getAppsForUser, hasCrmAppObjectAccess } from "@/lib/crm-app-access";
import { requireCrmAdmin } from "@/lib/crm-setup-api";
import { isRoleName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: 500,
    });
    return NextResponse.json({ users });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      mustChangePassword: true,
      profileId: true,
      profile: { select: { id: true, name: true, key: true, allowLogin: true } },
      permissionSetAssignments: { include: { permissionSet: { select: { id: true, name: true, key: true } } } },
    },
  });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const [objects, apps] = await Promise.all([
    prisma.crmObject.findMany({
      where: { active: true },
      include: { fields: { where: { active: true }, select: { id: true, apiName: true, label: true } } },
      orderBy: [{ module: "asc" }, { name: "asc" }],
    }),
    getAppsForUser(user),
  ]);
  const objectPermissions = await Promise.all(objects.map(async (object) => {
    const [capabilities, appAccess, fieldCapabilities, profileGrant, permissionSetGrants] = await Promise.all([
      getCrmObjectCapabilities(user, object.id),
      hasCrmAppObjectAccess(user, object.id),
      getCrmFieldCapabilities(user, object.id, object.fields.map(({ id }) => id)),
      prisma.crmProfileObjectPermission.findUnique({
        where: { profileId_objectId: { profileId: user.profileId, objectId: object.id } },
        select: { viewAll: true, modifyAll: true },
      }),
      prisma.crmPermissionSetObjectPermission.findMany({
        where: { objectId: object.id, permissionSet: { assignments: { some: { userId: user.id } } } },
        select: { viewAll: true, modifyAll: true },
      }),
    ]);
    return {
      id: object.id,
      apiName: object.apiName,
      name: object.name,
      module: object.module,
      appAccess,
      capabilities,
      viewAll: user.role === "ADMIN" || profileGrant?.viewAll === true || profileGrant?.modifyAll === true ||
        permissionSetGrants.some(({ viewAll, modifyAll }) => viewAll || modifyAll),
      modifyAll: user.role === "ADMIN" || profileGrant?.modifyAll === true ||
        permissionSetGrants.some(({ modifyAll }) => modifyAll),
      fields: object.fields.map((field) => ({
        id: field.id,
        apiName: field.apiName,
        label: field.label,
        canRead: fieldCapabilities.get(field.id)?.canRead === true,
        canEdit: fieldCapabilities.get(field.id)?.canEdit === true,
      })),
    };
  }));
  const accessibleTabs = new Set(apps.flatMap((app) => app.assignments.map(({ objectId: id }) => id)));
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      profile: user.profile,
      loginPermitted: user.active && user.profile.allowLogin && !user.mustChangePassword && isRoleName(user.role),
      permissionSets: user.permissionSetAssignments.map(({ permissionSet }) => permissionSet),
    },
    apps: apps.map((app) => ({
      id: app.id,
      name: app.name,
      objects: app.assignments.map(({ objectId, object }) => ({ id: objectId, name: object.name, apiName: object.apiName })),
    })),
    objects: objectPermissions.map((object) => ({ ...object, tabVisible: accessibleTabs.has(object.id) })),
  });
}
