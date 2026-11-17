import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@prisma/client";
import { seedCrmRegistry } from "../src/lib/crm-registry";

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters before seeding.");
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "ADMIN" || !existing.active) {
      throw new Error("The configured seed email belongs to an inactive or non-Admin account; review it before proceeding.");
    }
    return existing;
  }

  const profile = await prisma.crmProfile.findUnique({
    where: { key: "system-administrator" },
    select: { id: true },
  });
  if (!profile) throw new Error("The System Administrator profile is missing; apply database migrations before seeding.");

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const usernameBase = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 22) || "admin";
  const username = `${usernameBase}_${randomUUID().replaceAll("-", "").slice(0, 6).toLowerCase()}`;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: {
      id,
      name: "Anu Computers Admin",
      email,
      username,
      firstName: "Anu",
      lastName: "Computers Admin",
      emailVerified: true,
      role: "ADMIN",
      profileId: profile.id,
      active: true,
    } });
    await tx.account.create({ data: {
      id: randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
    } });
    return user;
  });
}

async function main() {
  const admin = await seedAdmin();
  const registeredObjects = await seedCrmRegistry(prisma);
  if (process.env.NODE_ENV === "production") {
    console.log(`Production Admin account verified: ${admin.email}. ${registeredObjects} standard CRM objects registered; demo records were not seeded.`);
    return;
  }
  const laptopCategory = await prisma.productCategory.upsert({
    where: { name: "Laptops" }, update: {}, create: { name: "Laptops" },
  });
  const componentCategory = await prisma.productCategory.upsert({
    where: { name: "Components" }, update: {}, create: { name: "Components" },
  });
  const laptop = await prisma.product.upsert({
    where: { sku: "ANU-LTP-14P" },
    update: {},
    create: {
      sku: "ANU-LTP-14P", name: "14-inch Business Laptop", brand: "Northstar",
      model: "WorkPro 14", manufacturerPart: "NS-WP14-I5", unitPrice: "85000.00",
      trackingType: "SERIAL", warrantyMonths: 24, categoryId: laptopCategory.id,
    },
  });
  const ic = await prisma.product.upsert({
    where: { sku: "ANU-IC-AT32" },
    update: {},
    create: {
      sku: "ANU-IC-AT32", name: "AT32 Control IC", brand: "MicroCore",
      manufacturerPart: "MC-AT32-01", unitPrice: "145.50", trackingType: "QUANTITY",
      warrantyMonths: 0, categoryId: componentCategory.id,
    },
  });
  let customer = await prisma.customer.findFirst({ where: { name: "Bluebell Design Studio" } });
  if (!customer) customer = await prisma.customer.create({ data: {
    name: "Bluebell Design Studio", kind: "BUSINESS", email: "it@bluebell.example",
    phone: "+91 98765 43210", taxId: "DEMO-TAX-001",
    addresses: { create: [
      { label: "Billing", line1: "18 Lake View Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001" },
      { label: "Shipping", line1: "18 Lake View Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001" },
    ] },
  } });
  const lead = await prisma.lead.upsert({
    where: { reference: "LEAD-DEMO-001" },
    update: { status: "QUALIFIED", customerId: customer.id, assigneeId: admin.id },
    create: {
      reference: "LEAD-DEMO-001", name: "Riya Mehta", email: "riya@bluebell.example",
      phone: "+91 98765 43210", source: "REFERRAL", interest: "14-inch business laptops",
      estimatedQuantity: 10, notes: "Fictional demo enquiry for a design team.",
      status: "QUALIFIED", assigneeId: admin.id, customerId: customer.id,
      activities: { create: { authorId: admin.id, kind: "CALL", note: "Discussed laptop refresh for the design team." } },
    },
  });
  let quote = await prisma.quote.findUnique({ where: { reference: "QUO-DEMO-001" } });
  if (!quote) quote = await prisma.quote.create({ data: {
    reference: "QUO-DEMO-001", customerId: customer.id, leadId: lead.id, createdById: admin.id,
    status: "ACCEPTED", subtotal: "850000.00", discount: "0.00", total: "850000.00",
    addressSnapshot: { line1: "18 Lake View Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "India" },
    items: { create: { productId: laptop.id, skuSnapshot: laptop.sku, description: laptop.name, quantity: 10, unitPrice: "85000.00", discount: "0.00" } },
  } });
  let laptopOrder = await prisma.order.findUnique({ where: { reference: "ORD-DEMO-001" }, include: { items: true } });
  if (!laptopOrder) laptopOrder = await prisma.order.create({ data: {
    reference: "ORD-DEMO-001", customerId: customer.id, quoteId: quote.id, ownerId: admin.id,
    status: "PARTIALLY_SHIPPED", subtotal: "850000.00", total: "850000.00",
    invoiceReference: "INV-DEMO-001", shippingSnapshot: quote.addressSnapshot ?? undefined,
    items: { create: { productId: laptop.id, skuSnapshot: laptop.sku, description: laptop.name, quantity: 10, unitPrice: "85000.00" } },
  }, include: { items: true } });
  const laptopLine = laptopOrder.items[0];
  const serials = ["ANUDEMO-LTP-0001", "ANUDEMO-LTP-0002", "ANUDEMO-LTP-0003", "ANUDEMO-LTP-0004", "ANUDEMO-LTP-0005", "ANUDEMO-LTP-0006"];
  let laptopShipment = await prisma.shipment.findUnique({ where: { reference: "SHP-DEMO-001" } });
  if (!laptopShipment) {
    laptopShipment = await prisma.shipment.create({ data: {
      reference: "SHP-DEMO-001", orderId: laptopOrder.id, shippedAt: new Date("2026-10-28T07:30:00Z"),
      deliveredAt: new Date("2026-10-29T08:30:00Z"), carrier: "Demo Logistics", tracking: "DEMO-TRACK-001",
      items: { create: { orderItemId: laptopLine.id, quantity: 6, delivered: 6, serials } },
    } });
  }
  const deliveredAt = laptopShipment.deliveredAt || new Date("2026-10-29T08:30:00Z");
  for (const serial of serials) {
    await prisma.purchasedUnit.upsert({
      where: { productId_normalizedSerial: { productId: laptop.id, normalizedSerial: serial } },
      update: {},
      create: {
        customerId: customer.id, productId: laptop.id, orderItemId: laptopLine.id,
        serial, normalizedSerial: serial, warrantyStart: deliveredAt,
        warrantyEnd: new Date(new Date(deliveredAt).setMonth(deliveredAt.getMonth() + laptop.warrantyMonths)),
      },
    });
  }
  let icOrder = await prisma.order.findUnique({ where: { reference: "ORD-DEMO-002" }, include: { items: true } });
  if (!icOrder) icOrder = await prisma.order.create({ data: {
    reference: "ORD-DEMO-002", customerId: customer.id, ownerId: admin.id,
    status: "DELIVERED", subtotal: "7275.00", total: "7275.00", invoiceReference: "INV-DEMO-002",
    items: { create: { productId: ic.id, skuSnapshot: ic.sku, description: ic.name, quantity: 50, unitPrice: "145.50" } },
  }, include: { items: true } });
  if (!await prisma.shipment.findUnique({ where: { reference: "SHP-DEMO-002" } })) {
    await prisma.shipment.create({ data: {
      reference: "SHP-DEMO-002", orderId: icOrder.id, shippedAt: new Date("2026-10-30T06:00:00Z"),
      deliveredAt: new Date("2026-10-31T06:00:00Z"), carrier: "Demo Logistics",
      items: { create: { orderItemId: icOrder.items[0].id, quantity: 50, delivered: 50 } },
    } });
  }
  if (!await prisma.serviceTicket.findUnique({ where: { reference: "TKT-DEMO-001" } })) {
    const purchasedUnit = await prisma.purchasedUnit.findUniqueOrThrow({
      where: { productId_normalizedSerial: { productId: laptop.id, normalizedSerial: serials[0] } },
    });
    await prisma.serviceTicket.create({ data: {
      reference: "TKT-DEMO-001", customerId: customer.id, unitId: purchasedUnit.id, orderId: laptopOrder.id,
      type: "TECHNICAL", title: "Laptop setup and display check",
      description: "Customer reports intermittent external monitor detection during initial setup. Fictional demonstration ticket.",
      status: "ASSIGNED", priority: "NORMAL", assigneeId: admin.id,
      updates: { create: { authorId: admin.id, kind: "CREATED", note: "Opened during the demo service handoff." } },
    } });
  }
  await prisma.businessSetting.upsert({ where: { key: "timezone" }, create: { key: "timezone", value: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata" }, update: {} });
  await prisma.businessSetting.upsert({ where: { key: "defaultWarrantyMonths" }, create: { key: "defaultWarrantyMonths", value: "12" }, update: {} });
  console.log("Seed complete: Admin account and fictional laptop, IC, order, delivery, serial, and service journey.");
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
