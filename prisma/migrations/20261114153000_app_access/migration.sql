DROP TABLE "crm_workspace_assignments";
ALTER TABLE "crm_objects" DROP COLUMN "workspace_available";

CREATE TABLE "crm_app_permissions" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "can_access" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_app_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_app_permissions_app_id_role_id_key"
ON "crm_app_permissions"("app_id", "role_id");

ALTER TABLE "crm_app_permissions"
ADD CONSTRAINT "crm_app_permissions_app_id_fkey"
FOREIGN KEY ("app_id") REFERENCES "crm_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_app_permissions"
ADD CONSTRAINT "crm_app_permissions_role_id_fkey"
FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
