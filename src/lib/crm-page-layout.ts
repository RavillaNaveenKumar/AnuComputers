import { prisma } from "@/lib/prisma";

/** Resolves the profile's Master layout without changing object or field authorization. */
export async function resolveCrmPageLayout(objectId: string, profileId: string | null, recordTypeKey = "MASTER") {
  const assignment = profileId ? await prisma.crmPageLayoutAssignment.findUnique({
    where: { objectId_profileId_recordTypeKey: { objectId, profileId, recordTypeKey } },
    include: { layout: { select: { id: true, fieldOrder: true, hiddenFieldIds: true, requiredFieldIds: true, readOnlyFieldIds: true, sections: true, relatedLists: true, detailTabs: true } } },
  }) : null;
  const layout = assignment?.layout ?? await prisma.crmPageLayout.findFirst({
    where: { objectId, isDefault: true },
    select: { id: true, fieldOrder: true, hiddenFieldIds: true, requiredFieldIds: true, readOnlyFieldIds: true, sections: true, relatedLists: true, detailTabs: true },
  });
  return layout ? {
    id: layout.id,
    fieldOrder: layout.fieldOrder,
    hiddenFieldIds: layout.hiddenFieldIds,
    requiredFieldIds: layout.requiredFieldIds,
    readOnlyFieldIds: layout.readOnlyFieldIds,
    sections: layout.sections,
    relatedLists: layout.relatedLists,
    detailTabs: layout.detailTabs,
  } : null;
}
