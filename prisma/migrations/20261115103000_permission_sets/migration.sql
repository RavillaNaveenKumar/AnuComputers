CREATE TABLE "crm_permission_sets" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_permission_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_permission_set_assignments" (
    "user_id" TEXT NOT NULL,
    "permission_set_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_permission_set_assignments_pkey" PRIMARY KEY ("user_id", "permission_set_id")
);

CREATE TABLE "crm_permission_set_object_permissions" (
    "id" TEXT NOT NULL,
    "permission_set_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "view_all" BOOLEAN NOT NULL DEFAULT false,
    "modify_all" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_permission_set_object_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_permission_set_field_permissions" (
    "id" TEXT NOT NULL,
    "permission_set_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_permission_set_field_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_permission_set_app_permissions" (
    "id" TEXT NOT NULL,
    "permission_set_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "can_access" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_permission_set_app_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_permission_set_tab_permissions" (
    "id" TEXT NOT NULL,
    "permission_set_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'DEFAULT_OFF',
    CONSTRAINT "crm_permission_set_tab_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_permission_sets_key_key" ON "crm_permission_sets"("key");
CREATE UNIQUE INDEX "crm_permission_sets_name_key" ON "crm_permission_sets"("name");
CREATE INDEX "crm_permission_set_assignments_permission_set_id_idx" ON "crm_permission_set_assignments"("permission_set_id");
CREATE UNIQUE INDEX "crm_permission_set_object_permissions_permission_set_id_object_id_key" ON "crm_permission_set_object_permissions"("permission_set_id", "object_id");
CREATE UNIQUE INDEX "crm_permission_set_field_permissions_permission_set_id_field_id_key" ON "crm_permission_set_field_permissions"("permission_set_id", "field_id");
CREATE UNIQUE INDEX "crm_permission_set_app_permissions_permission_set_id_app_id_key" ON "crm_permission_set_app_permissions"("permission_set_id", "app_id");
CREATE UNIQUE INDEX "crm_permission_set_tab_permissions_permission_set_id_app_id_object_id_key" ON "crm_permission_set_tab_permissions"("permission_set_id", "app_id", "object_id");

ALTER TABLE "crm_permission_set_assignments" ADD CONSTRAINT "crm_permission_set_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_assignments" ADD CONSTRAINT "crm_permission_set_assignments_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "crm_permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_object_permissions" ADD CONSTRAINT "crm_permission_set_object_permissions_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "crm_permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_object_permissions" ADD CONSTRAINT "crm_permission_set_object_permissions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_field_permissions" ADD CONSTRAINT "crm_permission_set_field_permissions_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "crm_permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_field_permissions" ADD CONSTRAINT "crm_permission_set_field_permissions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_app_permissions" ADD CONSTRAINT "crm_permission_set_app_permissions_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "crm_permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_app_permissions" ADD CONSTRAINT "crm_permission_set_app_permissions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "crm_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_tab_permissions" ADD CONSTRAINT "crm_permission_set_tab_permissions_permission_set_id_fkey" FOREIGN KEY ("permission_set_id") REFERENCES "crm_permission_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_tab_permissions" ADD CONSTRAINT "crm_permission_set_tab_permissions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "crm_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_permission_set_tab_permissions" ADD CONSTRAINT "crm_permission_set_tab_permissions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
