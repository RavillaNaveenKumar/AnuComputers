import { loadEnvConfig } from "@next/env";

const execute = process.argv.includes("--execute");

async function main() {
  loadEnvConfig(process.cwd());
  const { prisma } = await import("../src/lib/prisma");
  try {
    const [{ name: databaseName }] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    const counts = {
      accounts: await prisma.customer.count(),
      contacts: await prisma.contact.count(),
      addresses: await prisma.address.count(),
      leads: await prisma.lead.count(),
      leadActivities: await prisma.leadActivity.count(),
      products: await prisma.product.count(),
      productCategories: await prisma.productCategory.count(),
      quotes: await prisma.quote.count(),
      quoteItems: await prisma.quoteItem.count(),
      orders: await prisma.order.count(),
      orderItems: await prisma.orderItem.count(),
      shipments: await prisma.shipment.count(),
      shipmentItems: await prisma.shipmentItem.count(),
      purchasedUnits: await prisma.purchasedUnit.count(),
      cases: await prisma.serviceTicket.count(),
      caseComments: await prisma.ticketUpdate.count(),
      registryRecords: await prisma.crmRecord.count(),
      registryShares: await prisma.crmRecordShare.count(),
      nativeFieldValues: await prisma.crmNativeFieldValue.count(),
      nativeMetadata: await prisma.crmNativeRecordMetadata.count(),
      nativeShares: await prisma.crmNativeRecordShare.count(),
      idempotencyRecords: await prisma.idempotencyRecord.count(),
    };
    console.log(JSON.stringify({ databaseName, counts }, null, 2));
    if (!execute) {
      console.log("Dry run only. Pass --execute and the required safety environment values to delete CRM business data.");
      return;
    }
    if (process.env.CRM_PURGE_TARGET_DATABASE !== databaseName) {
      throw new Error("CRM_PURGE_TARGET_DATABASE must exactly match the current database name.");
    }
    if (process.env.CRM_PURGE_BACKUP_RESTORE_VERIFIED !== "true") {
      throw new Error("Confirm a fresh backup was successfully restored by setting CRM_PURGE_BACKUP_RESTORE_VERIFIED=true.");
    }
    if (process.env.CRM_PURGE_CONFIRMATION !== "DELETE_ALL_CRM_BUSINESS_DATA") {
      throw new Error("Set CRM_PURGE_CONFIRMATION=DELETE_ALL_CRM_BUSINESS_DATA to authorize this purge.");
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const result = {
        nativeShares: (await tx.crmNativeRecordShare.deleteMany()).count,
        nativeMetadata: (await tx.crmNativeRecordMetadata.deleteMany()).count,
        nativeFieldValues: (await tx.crmNativeFieldValue.deleteMany()).count,
        registryShares: (await tx.crmRecordShare.deleteMany()).count,
        registryRecords: (await tx.crmRecord.deleteMany()).count,
        caseComments: (await tx.ticketUpdate.deleteMany()).count,
        leadActivities: (await tx.leadActivity.deleteMany()).count,
        shipmentItems: (await tx.shipmentItem.deleteMany()).count,
        shipments: (await tx.shipment.deleteMany()).count,
        purchasedUnits: 0,
        cases: 0,
        orderItems: (await tx.orderItem.deleteMany()).count,
        quoteItems: (await tx.quoteItem.deleteMany()).count,
        orders: (await tx.order.deleteMany()).count,
        quotes: (await tx.quote.deleteMany()).count,
        leads: (await tx.lead.deleteMany()).count,
        contacts: (await tx.contact.deleteMany()).count,
        addresses: (await tx.address.deleteMany()).count,
        products: 0,
        productCategories: 0,
        accounts: 0,
        idempotencyRecords: (await tx.idempotencyRecord.deleteMany()).count,
      };
      await tx.purchasedUnit.updateMany({ data: { replacedUnitId: null } });
      result.purchasedUnits = (await tx.purchasedUnit.deleteMany()).count;
      result.cases = (await tx.serviceTicket.deleteMany()).count;
      result.products = (await tx.product.deleteMany()).count;
      result.productCategories = (await tx.productCategory.deleteMany()).count;
      result.accounts = (await tx.customer.deleteMany()).count;
      await tx.crmAuditLog.create({
        data: {
          action: "CRM_BUSINESS_DATA_PURGED",
          resourceType: "CRM_DATASET",
          resourceId: databaseName,
          details: result,
        },
      });
      return result;
    }, { timeout: 120000 });

    console.log(JSON.stringify({ deleted }, null, 2));
    console.log("CRM business data was deleted. Users, CRM setup metadata, security configuration, login history, and audit history were preserved.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
