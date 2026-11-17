import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const assignmentSchema = z.object({ profileId: z.string().min(1), layoutId: z.string().min(1).nullable() });
const saveSchema = z.object({ assignments: z.array(assignmentSchema).max(500) }).superRefine(({ assignments }, context) => {
  if (new Set(assignments.map(({ profileId }) => profileId)).size !== assignments.length) context.addIssue({ code: "custom", message: "Each profile can appear only once." });
});

export async function GET(_request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const [object, profiles, layouts, assignments] = await Promise.all([
    prisma.crmObject.findUnique({ where: { id: objectId }, select: { id: true, name: true, pluralLabel: true, apiName: true } }),
    prisma.crmProfile.findMany({ select: { id: true, name: true }, orderBy: [{ builtIn: "desc" }, { name: "asc" }] }),
    prisma.crmPageLayout.findMany({ where: { objectId }, select: { id: true, name: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.crmPageLayoutAssignment.findMany({ where: { objectId, recordTypeKey: "MASTER" }, select: { profileId: true, layoutId: true } }),
  ]);
  if (!object) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  const assigned = new Map(assignments.map(({ profileId, layoutId }) => [profileId, layoutId]));
  return NextResponse.json({ object, profiles, layouts, assignments: profiles.map((profile) => ({ profileId: profile.id, layoutId: assigned.get(profile.id) ?? null })) });
}

export async function PUT(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = saveSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const profileIds = new Set((await prisma.crmProfile.findMany({ select: { id: true } })).map(({ id }) => id));
  const layoutIds = new Set((await prisma.crmPageLayout.findMany({ where: { objectId }, select: { id: true } })).map(({ id }) => id));
  if (input.data.assignments.some(({ profileId }) => !profileIds.has(profileId))) return NextResponse.json({ error: "One or more profiles do not exist." }, { status: 400 });
  if (input.data.assignments.some(({ layoutId }) => layoutId && !layoutIds.has(layoutId))) return NextResponse.json({ error: "Every selected layout must belong to this object." }, { status: 400 });
  const object = await prisma.crmObject.findUnique({ where: { id: objectId }, select: { id: true } });
  if (!object) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  const saved = await prisma.$transaction(async (tx) => {
    const changed: { profileId: string; layoutId: string | null }[] = [];
    for (const item of input.data.assignments) {
      const previous = await tx.crmPageLayoutAssignment.findUnique({ where: { objectId_profileId_recordTypeKey: { objectId, profileId: item.profileId, recordTypeKey: "MASTER" } } });
      if (item.layoutId === null) {
        if (previous) {
          await tx.crmPageLayoutAssignment.delete({ where: { id: previous.id } });
          changed.push(item);
        }
      } else if (previous?.layoutId !== item.layoutId) {
        await tx.crmPageLayoutAssignment.upsert({
          where: { objectId_profileId_recordTypeKey: { objectId, profileId: item.profileId, recordTypeKey: "MASTER" } },
          create: { objectId, profileId: item.profileId, recordTypeKey: "MASTER", layoutId: item.layoutId },
          update: { layoutId: item.layoutId },
        });
        changed.push(item);
      }
    }
    for (const item of changed) await auditCrmChange(tx, auth.user.id, "PAGE_LAYOUT_ASSIGNED", "CrmPageLayoutAssignment", `${objectId}:${item.profileId}:MASTER`, { objectId, profileId: item.profileId, layoutId: item.layoutId });
    return changed;
  });
  return NextResponse.json({ saved: saved.length });
}
