CREATE TYPE "CrmObjectType" AS ENUM ('STANDARD', 'CUSTOM', 'SYSTEM');
CREATE TYPE "CrmModule" AS ENUM ('SALES', 'SERVICE', 'COMMON');
CREATE TYPE "CrmFieldType" AS ENUM ('TEXT', 'TEXT_AREA', 'NUMBER', 'CURRENCY', 'DATE', 'DATETIME', 'EMAIL', 'PHONE', 'URL', 'CHECKBOX', 'PICKLIST', 'MULTI_SELECT_PICKLIST', 'LOOKUP', 'AUTO_NUMBER');
CREATE TYPE "CrmRelationshipType" AS ENUM ('LOOKUP', 'ONE_TO_MANY', 'MANY_TO_MANY');

CREATE TABLE "crm_objects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plural_label" TEXT NOT NULL,
    "api_name" TEXT NOT NULL,
    "description" TEXT,
    "object_type" "CrmObjectType" NOT NULL DEFAULT 'CUSTOM',
    "module" "CrmModule" NOT NULL DEFAULT 'COMMON',
    "icon" TEXT NOT NULL DEFAULT 'Database',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "workspace_available" BOOLEAN NOT NULL DEFAULT true,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_objects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_objects_api_name_key" ON "crm_objects"("api_name");
CREATE INDEX "crm_objects_module_object_type_active_idx" ON "crm_objects"("module", "object_type", "active");

CREATE TABLE "crm_fields" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "api_name" TEXT NOT NULL,
    "data_type" "CrmFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "default_value" TEXT,
    "unique" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "help_text" TEXT,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_fields_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_fields_object_id_api_name_key" ON "crm_fields"("object_id", "api_name");
CREATE INDEX "crm_fields_object_id_active_position_idx" ON "crm_fields"("object_id", "active", "position");
ALTER TABLE "crm_fields" ADD CONSTRAINT "crm_fields_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_relationships" (
    "id" TEXT NOT NULL,
    "source_object_id" TEXT NOT NULL,
    "target_object_id" TEXT NOT NULL,
    "field_id" TEXT,
    "label" TEXT NOT NULL,
    "relationship_type" "CrmRelationshipType" NOT NULL DEFAULT 'LOOKUP',
    "junction_object_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_relationships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_relationships_field_id_key" ON "crm_relationships"("field_id");
CREATE INDEX "crm_relationships_source_object_id_idx" ON "crm_relationships"("source_object_id");
CREATE INDEX "crm_relationships_target_object_id_idx" ON "crm_relationships"("target_object_id");
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_source_object_id_fkey" FOREIGN KEY ("source_object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_target_object_id_fkey" FOREIGN KEY ("target_object_id") REFERENCES "crm_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_junction_object_id_fkey" FOREIGN KEY ("junction_object_id") REFERENCES "crm_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_picklist_values" (
    "id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "crm_picklist_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_picklist_values_field_id_value_key" ON "crm_picklist_values"("field_id", "value");
CREATE INDEX "crm_picklist_values_field_id_active_position_idx" ON "crm_picklist_values"("field_id", "active", "position");
ALTER TABLE "crm_picklist_values" ADD CONSTRAINT "crm_picklist_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_apps" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Boxes',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "default_object_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_apps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_apps_key_key" ON "crm_apps"("key");
ALTER TABLE "crm_apps" ADD CONSTRAINT "crm_apps_default_object_id_fkey" FOREIGN KEY ("default_object_id") REFERENCES "crm_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crm_workspace_assignments" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "navigation_order" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "icon" TEXT,
    "default_list_view" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_workspace_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_workspace_assignments_object_id_key" ON "crm_workspace_assignments"("object_id");
CREATE INDEX "crm_workspace_assignments_active_navigation_order_idx" ON "crm_workspace_assignments"("active", "navigation_order");
ALTER TABLE "crm_workspace_assignments" ADD CONSTRAINT "crm_workspace_assignments_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_app_assignments" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "navigation_order" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "icon" TEXT,
    "default_list_view" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_app_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_app_assignments_app_id_object_id_key" ON "crm_app_assignments"("app_id", "object_id");
CREATE INDEX "crm_app_assignments_app_id_active_navigation_order_idx" ON "crm_app_assignments"("app_id", "active", "navigation_order");
ALTER TABLE "crm_app_assignments" ADD CONSTRAINT "crm_app_assignments_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "crm_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_app_assignments" ADD CONSTRAINT "crm_app_assignments_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_page_layouts" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Record Layout',
    "field_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hidden_field_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sections" JSONB NOT NULL DEFAULT '[]',
    "related_lists" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail_tabs" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_page_layouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_page_layouts_object_id_key" ON "crm_page_layouts"("object_id");
ALTER TABLE "crm_page_layouts" ADD CONSTRAINT "crm_page_layouts_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_roles_key_key" ON "crm_roles"("key");
CREATE UNIQUE INDEX "crm_roles_name_key" ON "crm_roles"("name");

CREATE TABLE "crm_users_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_users_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);
CREATE INDEX "crm_users_roles_role_id_idx" ON "crm_users_roles"("role_id");
ALTER TABLE "crm_users_roles" ADD CONSTRAINT "crm_users_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_users_roles" ADD CONSTRAINT "crm_users_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_object_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_object_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_object_permissions_role_id_object_id_key" ON "crm_object_permissions"("role_id", "object_id");
ALTER TABLE "crm_object_permissions" ADD CONSTRAINT "crm_object_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_object_permissions" ADD CONSTRAINT "crm_object_permissions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_field_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT true,
    "can_edit" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "crm_field_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_field_permissions_role_id_field_id_key" ON "crm_field_permissions"("role_id", "field_id");
ALTER TABLE "crm_field_permissions" ADD CONSTRAINT "crm_field_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "crm_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_field_permissions" ADD CONSTRAINT "crm_field_permissions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crm_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_audit_logs_resource_type_resource_id_created_at_idx" ON "crm_audit_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "crm_audit_logs_actor_id_created_at_idx" ON "crm_audit_logs"("actor_id", "created_at");
ALTER TABLE "crm_audit_logs" ADD CONSTRAINT "crm_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
