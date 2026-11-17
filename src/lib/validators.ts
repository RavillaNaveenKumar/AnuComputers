import { z } from "zod";

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["BUSINESS", "INDIVIDUAL"]).default("BUSINESS"),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  taxId: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  manufacturerPart: z.string().trim().max(100).optional(),
  unitPrice: z.coerce.number().finite().min(0),
  trackingType: z.enum(["SERIAL", "QUANTITY"]),
  warrantyMonths: z.coerce.number().int().min(0).max(1200).optional(),
  categoryId: z.string().optional().or(z.literal("")),
});

export const leadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().min(1).max(50),
  interest: z.string().trim().max(500).optional(),
  estimatedQuantity: z.coerce.number().int().min(1).max(100000),
  notes: z.string().trim().max(3000).optional(),
  assigneeId: z.string().optional(),
  nextFollowUpAt: z.preprocess((value) => value === "" ? undefined : value, z.coerce.date().optional()),
});

export const quoteSchema = z.object({
  customerId: z.string().min(1),
  leadId: z.string().optional(),
  validUntil: z.coerce.date().optional(),
  discount: z.coerce.number().min(0),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().min(1).max(100000),
    unitPrice: z.coerce.number().finite().min(0),
    discount: z.coerce.number().min(0).default(0),
  })).min(1),
});

export const ticketSchema = z.object({
  customerId: z.string().min(1),
  unitId: z.string().optional(),
  orderId: z.string().optional(),
  type: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(3000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  assigneeId: z.string().optional(),
});
