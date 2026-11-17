ALTER TABLE "Product" ADD COLUMN "description" TEXT;

CREATE TABLE "crm_native_field_values" (
    "id" TEXT NOT NULL,
    "object_api_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_native_field_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_native_field_values_object_api_name_record_id_field_id_key"
ON "crm_native_field_values"("object_api_name", "record_id", "field_id");

CREATE INDEX "crm_native_field_values_object_api_name_record_id_idx"
ON "crm_native_field_values"("object_api_name", "record_id");

ALTER TABLE "crm_native_field_values"
ADD CONSTRAINT "crm_native_field_values_field_id_fkey"
FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
