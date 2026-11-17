CREATE TABLE "crm_native_record_shares" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "access" "CrmRecordShareAccess" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_native_record_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_native_record_shares_record_id_check" CHECK ("record_id" <> '')
);

CREATE UNIQUE INDEX "crm_native_record_shares_object_id_record_id_user_id_key"
ON "crm_native_record_shares"("object_id", "record_id", "user_id");

CREATE INDEX "crm_native_record_shares_user_id_object_id_record_id_idx"
ON "crm_native_record_shares"("user_id", "object_id", "record_id");

ALTER TABLE "crm_native_record_shares"
ADD CONSTRAINT "crm_native_record_shares_object_id_fkey"
FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_native_record_shares"
ADD CONSTRAINT "crm_native_record_shares_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_native_record_shares"
ADD CONSTRAINT "crm_native_record_shares_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
