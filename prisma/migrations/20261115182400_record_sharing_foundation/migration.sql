CREATE TYPE "CrmObjectDefaultAccess" AS ENUM (
    'PRIVATE',
    'PUBLIC_READ_ONLY',
    'PUBLIC_READ_WRITE',
    'CONTROLLED_BY_PARENT'
);

CREATE TYPE "CrmSharingRuleType" AS ENUM ('OWNER', 'CRITERIA');
CREATE TYPE "CrmRecordShareAccess" AS ENUM ('READ', 'EDIT');

ALTER TABLE "crm_records"
ADD COLUMN "owner_id" TEXT;

CREATE INDEX "crm_records_owner_id_object_id_idx"
ON "crm_records"("owner_id", "object_id");

ALTER TABLE "crm_records"
ADD CONSTRAINT "crm_records_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crm_sharing_configs" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "default_access" "CrmObjectDefaultAccess" NOT NULL DEFAULT 'PRIVATE',
    "grant_access_using_hierarchy" BOOLEAN NOT NULL DEFAULT false,
    "parent_relationship_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_sharing_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_sharing_configs_parent_access_check"
        CHECK (
            ("default_access" = 'CONTROLLED_BY_PARENT' AND "parent_relationship_id" IS NOT NULL)
            OR ("default_access" <> 'CONTROLLED_BY_PARENT' AND "parent_relationship_id" IS NULL)
        )
);

CREATE UNIQUE INDEX "crm_sharing_configs_object_id_key"
ON "crm_sharing_configs"("object_id");

CREATE UNIQUE INDEX "crm_sharing_configs_parent_relationship_id_key"
ON "crm_sharing_configs"("parent_relationship_id");

CREATE TABLE "crm_sharing_rules" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule_type" "CrmSharingRuleType" NOT NULL,
    "source_hierarchy_role_id" TEXT,
    "source_includes_subordinates" BOOLEAN NOT NULL DEFAULT false,
    "criteria" JSONB,
    "target_user_id" TEXT,
    "target_hierarchy_role_id" TEXT,
    "target_includes_subordinates" BOOLEAN NOT NULL DEFAULT false,
    "access" "CrmRecordShareAccess" NOT NULL DEFAULT 'READ',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_sharing_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_sharing_rules_target_check"
        CHECK (
            ("target_user_id" IS NOT NULL AND "target_hierarchy_role_id" IS NULL)
            OR ("target_user_id" IS NULL AND "target_hierarchy_role_id" IS NOT NULL)
        ),
    CONSTRAINT "crm_sharing_rules_target_subordinates_check"
        CHECK ("target_hierarchy_role_id" IS NOT NULL OR "target_includes_subordinates" = false),
    CONSTRAINT "crm_sharing_rules_source_check"
        CHECK (
            ("rule_type" = 'OWNER' AND "source_hierarchy_role_id" IS NOT NULL AND "criteria" IS NULL)
            OR ("rule_type" = 'CRITERIA' AND "source_hierarchy_role_id" IS NULL AND "criteria" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX "crm_sharing_rules_object_id_name_key"
ON "crm_sharing_rules"("object_id", "name");

CREATE INDEX "crm_sharing_rules_object_id_active_rule_type_idx"
ON "crm_sharing_rules"("object_id", "active", "rule_type");

CREATE INDEX "crm_sharing_rules_source_hierarchy_role_id_idx"
ON "crm_sharing_rules"("source_hierarchy_role_id");

CREATE INDEX "crm_sharing_rules_target_hierarchy_role_id_idx"
ON "crm_sharing_rules"("target_hierarchy_role_id");

CREATE INDEX "crm_sharing_rules_target_user_id_idx"
ON "crm_sharing_rules"("target_user_id");

CREATE TABLE "crm_record_shares" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "access" "CrmRecordShareAccess" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_record_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_record_shares_record_id_user_id_key"
ON "crm_record_shares"("record_id", "user_id");

CREATE INDEX "crm_record_shares_user_id_record_id_idx"
ON "crm_record_shares"("user_id", "record_id");

ALTER TABLE "crm_sharing_configs"
ADD CONSTRAINT "crm_sharing_configs_object_id_fkey"
FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_sharing_configs"
ADD CONSTRAINT "crm_sharing_configs_parent_relationship_id_fkey"
FOREIGN KEY ("parent_relationship_id") REFERENCES "crm_relationships"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_sharing_rules"
ADD CONSTRAINT "crm_sharing_rules_object_id_fkey"
FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_sharing_rules"
ADD CONSTRAINT "crm_sharing_rules_source_hierarchy_role_id_fkey"
FOREIGN KEY ("source_hierarchy_role_id") REFERENCES "crm_hierarchy_roles"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_sharing_rules"
ADD CONSTRAINT "crm_sharing_rules_target_user_id_fkey"
FOREIGN KEY ("target_user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_sharing_rules"
ADD CONSTRAINT "crm_sharing_rules_target_hierarchy_role_id_fkey"
FOREIGN KEY ("target_hierarchy_role_id") REFERENCES "crm_hierarchy_roles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_record_shares"
ADD CONSTRAINT "crm_record_shares_record_id_fkey"
FOREIGN KEY ("record_id") REFERENCES "crm_records"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_record_shares"
ADD CONSTRAINT "crm_record_shares_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_record_shares"
ADD CONSTRAINT "crm_record_shares_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "crm_sharing_configs" (
    "id",
    "object_id",
    "default_access",
    "grant_access_using_hierarchy",
    "updated_at"
)
SELECT
    'sharing-' || "id",
    "id",
    'PUBLIC_READ_WRITE',
    false,
    CURRENT_TIMESTAMP
FROM "crm_objects"
ON CONFLICT ("object_id") DO NOTHING;
