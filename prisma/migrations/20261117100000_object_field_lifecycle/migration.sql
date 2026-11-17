ALTER TYPE "CrmFieldType" ADD VALUE IF NOT EXISTS 'ID';
ALTER TYPE "CrmFieldType" ADD VALUE IF NOT EXISTS 'LONG_TEXT_AREA';
ALTER TYPE "CrmFieldType" ADD VALUE IF NOT EXISTS 'PERCENT';

CREATE TYPE "CrmFieldOrigin" AS ENUM ('SYSTEM', 'STANDARD', 'CUSTOM');

ALTER TABLE "crm_objects"
ADD COLUMN "display_field_api_name" TEXT;

ALTER TABLE "Contact"
ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "QuoteItem"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "OrderItem"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "crm_fields"
ADD COLUMN "origin" "CrmFieldOrigin" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN "read_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "is_name_field" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "field_length" INTEGER,
ADD COLUMN "decimal_places" INTEGER,
ADD COLUMN "external_id" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lookup_target_api_name" TEXT,
ADD COLUMN "auto_number_prefix" TEXT,
ADD COLUMN "auto_number_suffix" TEXT,
ADD COLUMN "auto_number_start" INTEGER,
ADD COLUMN "auto_number_digits" INTEGER;

UPDATE "crm_fields" AS fields
SET "origin" = CASE WHEN fields."protected" THEN 'STANDARD'::"CrmFieldOrigin" ELSE 'CUSTOM'::"CrmFieldOrigin" END,
    "read_only" = fields."data_type" = 'AUTO_NUMBER',
    "field_length" = CASE WHEN fields."data_type" = 'TEXT' THEN 80 ELSE NULL END;

UPDATE "crm_fields"
SET "is_name_field" = true
WHERE "api_name" = 'Name';

UPDATE "crm_objects" AS objects
SET "display_field_api_name" = 'Name'
WHERE objects."object_type" = 'CUSTOM'
  AND EXISTS (
    SELECT 1 FROM "crm_fields" AS fields
    WHERE fields."object_id" = objects."id" AND fields."api_name" = 'Name'
  );

ALTER TABLE "crm_records"
ADD COLUMN "created_by_id" TEXT,
ADD COLUMN "last_modified_by_id" TEXT;

ALTER TABLE "crm_records"
ADD CONSTRAINT "crm_records_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "crm_records_last_modified_by_id_fkey"
FOREIGN KEY ("last_modified_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "crm_records_created_by_id_object_id_idx" ON "crm_records"("created_by_id", "object_id");
CREATE INDEX "crm_records_last_modified_by_id_object_id_idx" ON "crm_records"("last_modified_by_id", "object_id");

CREATE TABLE "crm_auto_number_counters" (
    "field_id" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_auto_number_counters_pkey" PRIMARY KEY ("field_id"),
    CONSTRAINT "crm_auto_number_counters_field_id_fkey"
      FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "crm_native_record_metadata" (
    "id" TEXT NOT NULL,
    "object_api_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "last_modified_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_native_record_metadata_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_native_record_metadata_object_api_name_fkey"
      FOREIGN KEY ("object_api_name") REFERENCES "crm_objects"("api_name") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "crm_native_record_metadata_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "crm_native_record_metadata_last_modified_by_id_fkey"
      FOREIGN KEY ("last_modified_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "crm_native_record_metadata_object_api_name_record_id_key"
ON "crm_native_record_metadata"("object_api_name", "record_id");
