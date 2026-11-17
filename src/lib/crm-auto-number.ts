import type { Prisma } from "@prisma/client";

type AutoNumberField = {
  id: string;
  autoNumberPrefix: string | null;
  autoNumberSuffix: string | null;
  autoNumberStart: number | null;
  autoNumberDigits: number | null;
};

export function formatCrmAutoNumber(value: string, prefix: string | null, suffix: string | null, digits: number | null) {
  return `${prefix ?? ""}${value.padStart(digits ?? 4, "0")}${suffix ?? ""}`;
}

export async function allocateCrmAutoNumber(tx: Prisma.TransactionClient, field: AutoNumberField) {
  const start = field.autoNumberStart ?? 1;
  const [counter] = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO "crm_auto_number_counters" ("field_id", "next_value", "updated_at")
    VALUES (${field.id}, ${start + 1}, CURRENT_TIMESTAMP)
    ON CONFLICT ("field_id") DO UPDATE
    SET "next_value" = "crm_auto_number_counters"."next_value" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    RETURNING "next_value" - 1 AS "value"
  `;
  return formatCrmAutoNumber(String(counter.value), field.autoNumberPrefix, field.autoNumberSuffix, field.autoNumberDigits);
}
