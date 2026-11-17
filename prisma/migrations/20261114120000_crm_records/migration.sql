CREATE TABLE "crm_records" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_records_object_id_updated_at_idx" ON "crm_records"("object_id", "updated_at");

ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_object_id_fkey"
FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
