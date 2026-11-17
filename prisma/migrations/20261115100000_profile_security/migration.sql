ALTER TABLE "User" ADD COLUMN "profile_id" TEXT;

CREATE TABLE "crm_profiles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "allow_login" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_profile_object_permissions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "view_all" BOOLEAN NOT NULL DEFAULT false,
    "modify_all" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_profile_object_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_profile_field_permissions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "editable" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "crm_profile_field_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_profile_app_permissions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "can_access" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crm_profile_app_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_profile_tab_permissions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'DEFAULT_ON',
    CONSTRAINT "crm_profile_tab_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_profiles_key_key" ON "crm_profiles"("key");
CREATE UNIQUE INDEX "crm_profiles_name_key" ON "crm_profiles"("name");
CREATE UNIQUE INDEX "crm_profile_object_permissions_profile_id_object_id_key" ON "crm_profile_object_permissions"("profile_id", "object_id");
CREATE UNIQUE INDEX "crm_profile_field_permissions_profile_id_field_id_key" ON "crm_profile_field_permissions"("profile_id", "field_id");
CREATE UNIQUE INDEX "crm_profile_app_permissions_profile_id_app_id_key" ON "crm_profile_app_permissions"("profile_id", "app_id");
CREATE UNIQUE INDEX "crm_profile_tab_permissions_profile_id_app_id_object_id_key" ON "crm_profile_tab_permissions"("profile_id", "app_id", "object_id");

INSERT INTO "crm_profiles" ("id", "key", "name", "description", "built_in", "allow_login", "updated_at") VALUES
    ('profile_system_administrator', 'system-administrator', 'System Administrator', 'Full administrative access to CRM objects, fields, and applications.', true, true, CURRENT_TIMESTAMP),
    ('profile_sales_manager', 'sales-manager', 'Sales Manager', 'Sales object and application access.', true, true, CURRENT_TIMESTAMP),
    ('profile_sales_user', 'sales-user', 'Sales User', 'Standard sales user access.', true, true, CURRENT_TIMESTAMP),
    ('profile_service_manager', 'service-manager', 'Service Manager', 'Service object and application access.', true, true, CURRENT_TIMESTAMP),
    ('profile_service_user', 'service-user', 'Service User', 'Standard service agent access.', true, true, CURRENT_TIMESTAMP),
    ('profile_technician', 'technician', 'Technician', 'Technician access to service records.', true, true, CURRENT_TIMESTAMP),
    ('profile_dispatch', 'dispatch', 'Dispatch', 'Dispatch access to sales orders and accounts.', true, true, CURRENT_TIMESTAMP);

UPDATE "User"
SET "profile_id" = CASE "role"
    WHEN 'ADMIN' THEN 'profile_system_administrator'
    WHEN 'SALES_MANAGER' THEN 'profile_sales_manager'
    WHEN 'SALES_EXECUTIVE' THEN 'profile_sales_user'
    WHEN 'DISPATCH' THEN 'profile_dispatch'
    WHEN 'SERVICE_MANAGER' THEN 'profile_service_manager'
    WHEN 'SERVICE_AGENT' THEN 'profile_service_user'
    WHEN 'TECHNICIAN' THEN 'profile_technician'
    ELSE 'profile_sales_user'
END;

ALTER TABLE "User" ALTER COLUMN "profile_id" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_profile_id_idx" ON "User"("profile_id");

INSERT INTO "crm_profile_object_permissions" ("id", "profile_id", "object_id", "can_create", "can_read", "can_edit", "can_delete", "view_all", "modify_all")
SELECT
    'profile_object_' || md5(p."id" || o."id"),
    p."id",
    o."id",
    CASE
        WHEN p."key" = 'system-administrator' THEN true
        WHEN p."key" IN ('sales-manager', 'sales-user') THEN o."module"::text = 'SALES' OR o."api_name" IN ('Account', 'Contact', 'Task', 'Event')
        WHEN p."key" IN ('service-manager', 'service-user', 'technician') THEN o."module"::text = 'SERVICE' OR o."api_name" IN ('Account', 'Contact', 'Task', 'Event')
        WHEN p."key" = 'dispatch' THEN o."api_name" = 'Order'
        ELSE false
    END,
    CASE
        WHEN p."key" = 'system-administrator' THEN true
        WHEN p."key" IN ('sales-manager', 'sales-user') THEN o."module"::text = 'SALES' OR o."api_name" IN ('Account', 'Contact', 'Task', 'Event')
        WHEN p."key" IN ('service-manager', 'service-user', 'technician') THEN o."module"::text = 'SERVICE' OR o."api_name" IN ('Account', 'Contact', 'Task', 'Event')
        WHEN p."key" = 'dispatch' THEN o."api_name" IN ('Account', 'Order')
        ELSE false
    END,
    CASE
        WHEN p."key" = 'system-administrator' THEN true
        WHEN p."key" IN ('sales-manager', 'sales-user') THEN o."module"::text = 'SALES' OR o."api_name" IN ('Account', 'Contact', 'Task', 'Event')
        WHEN p."key" = 'service-manager' THEN o."module"::text = 'SERVICE' OR o."api_name" IN ('Account', 'Contact', 'Task', 'Event')
        WHEN p."key" IN ('service-user', 'technician') THEN o."module"::text = 'SERVICE'
        WHEN p."key" = 'dispatch' THEN o."api_name" = 'Order'
        ELSE false
    END,
    p."key" = 'system-administrator',
    p."key" = 'system-administrator',
    p."key" = 'system-administrator'
FROM "crm_profiles" p
CROSS JOIN "crm_objects" o;

INSERT INTO "crm_profile_app_permissions" ("id", "profile_id", "app_id", "can_access")
SELECT
    'profile_app_' || md5(p."id" || a."id"),
    p."id",
    a."id",
    CASE
        WHEN p."key" = 'system-administrator' THEN true
        WHEN p."key" IN ('sales-manager', 'sales-user', 'dispatch') THEN a."key" = 'sales'
        WHEN p."key" IN ('service-manager', 'service-user', 'technician') THEN a."key" = 'service'
        ELSE false
    END
FROM "crm_profiles" p
CROSS JOIN "crm_apps" a;

INSERT INTO "crm_profile_field_permissions" ("id", "profile_id", "field_id", "visible", "editable")
SELECT
    'profile_field_' || md5(p."id" || f."id"),
    p."id",
    f."id",
    COALESCE(rfp."can_read", true),
    COALESCE(rfp."can_edit", op."can_edit") AND COALESCE(rfp."can_read", true) AND f."data_type"::text <> 'AUTO_NUMBER'
FROM "crm_profiles" p
CROSS JOIN "crm_fields" f
JOIN "crm_profile_object_permissions" op ON op."profile_id" = p."id" AND op."object_id" = f."object_id"
LEFT JOIN "crm_roles" r ON r."key" = CASE p."key"
    WHEN 'system-administrator' THEN 'ADMIN'
    WHEN 'sales-manager' THEN 'SALES_MANAGER'
    WHEN 'sales-user' THEN 'SALES_EXECUTIVE'
    WHEN 'dispatch' THEN 'DISPATCH'
    WHEN 'service-manager' THEN 'SERVICE_MANAGER'
    WHEN 'service-user' THEN 'SERVICE_AGENT'
    WHEN 'technician' THEN 'TECHNICIAN'
END
LEFT JOIN "crm_field_permissions" rfp ON rfp."role_id" = r."id" AND rfp."field_id" = f."id";

INSERT INTO "crm_profile_tab_permissions" ("id", "profile_id", "app_id", "object_id", "visibility")
SELECT
    'profile_tab_' || md5(p."id" || aa."app_id" || aa."object_id"),
    p."id",
    aa."app_id",
    aa."object_id",
    CASE WHEN ap."can_access" AND op."can_read" THEN 'DEFAULT_ON' ELSE 'HIDDEN' END
FROM "crm_profiles" p
CROSS JOIN "crm_app_assignments" aa
JOIN "crm_profile_app_permissions" ap ON ap."profile_id" = p."id" AND ap."app_id" = aa."app_id"
JOIN "crm_profile_object_permissions" op ON op."profile_id" = p."id" AND op."object_id" = aa."object_id";

ALTER TABLE "crm_profile_object_permissions" ADD CONSTRAINT "crm_profile_object_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_object_permissions" ADD CONSTRAINT "crm_profile_object_permissions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_field_permissions" ADD CONSTRAINT "crm_profile_field_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_field_permissions" ADD CONSTRAINT "crm_profile_field_permissions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "crm_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_app_permissions" ADD CONSTRAINT "crm_profile_app_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_app_permissions" ADD CONSTRAINT "crm_profile_app_permissions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "crm_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_tab_permissions" ADD CONSTRAINT "crm_profile_tab_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "crm_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_tab_permissions" ADD CONSTRAINT "crm_profile_tab_permissions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "crm_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_profile_tab_permissions" ADD CONSTRAINT "crm_profile_tab_permissions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
