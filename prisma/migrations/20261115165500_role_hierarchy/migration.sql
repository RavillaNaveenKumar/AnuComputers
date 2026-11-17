CREATE TABLE "crm_hierarchy_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_hierarchy_roles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "hierarchy_role_id" TEXT;

CREATE UNIQUE INDEX "crm_hierarchy_roles_key_key" ON "crm_hierarchy_roles"("key");
CREATE UNIQUE INDEX "crm_hierarchy_roles_name_key" ON "crm_hierarchy_roles"("name");
CREATE INDEX "crm_hierarchy_roles_parent_id_idx" ON "crm_hierarchy_roles"("parent_id");
CREATE INDEX "User_hierarchy_role_id_idx" ON "User"("hierarchy_role_id");

ALTER TABLE "User" ADD CONSTRAINT "User_hierarchy_role_id_fkey" FOREIGN KEY ("hierarchy_role_id") REFERENCES "crm_hierarchy_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_hierarchy_roles" ADD CONSTRAINT "crm_hierarchy_roles_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "crm_hierarchy_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "crm_hierarchy_roles" ("id", "key", "name", "description", "built_in", "parent_id", "updated_at") VALUES
    ('hierarchy-company', 'company', 'Company', 'Organization root.', true, NULL, CURRENT_TIMESTAMP),
    ('hierarchy-administrator', 'administrator', 'Administrator', 'Organization administrator.', true, 'hierarchy-company', CURRENT_TIMESTAMP),
    ('hierarchy-sales-manager', 'sales-manager', 'Sales Manager', 'Leads the sales organization.', true, 'hierarchy-company', CURRENT_TIMESTAMP),
    ('hierarchy-sales-executive', 'sales-executive', 'Sales Executive', 'Sales team member.', true, 'hierarchy-sales-manager', CURRENT_TIMESTAMP),
    ('hierarchy-service-manager', 'service-manager', 'Service Manager', 'Leads the service organization.', true, 'hierarchy-company', CURRENT_TIMESTAMP),
    ('hierarchy-service-agent', 'service-agent', 'Service Agent', 'Service team member.', true, 'hierarchy-service-manager', CURRENT_TIMESTAMP),
    ('hierarchy-technician', 'technician', 'Technician', 'Field and repair technician.', true, 'hierarchy-service-manager', CURRENT_TIMESTAMP),
    ('hierarchy-dispatch', 'dispatch', 'Dispatch', 'Dispatch team member.', true, 'hierarchy-company', CURRENT_TIMESTAMP);

UPDATE "User"
SET "hierarchy_role_id" = CASE "role"
    WHEN 'ADMIN' THEN 'hierarchy-administrator'
    WHEN 'SALES_MANAGER' THEN 'hierarchy-sales-manager'
    WHEN 'SALES_EXECUTIVE' THEN 'hierarchy-sales-executive'
    WHEN 'SERVICE_MANAGER' THEN 'hierarchy-service-manager'
    WHEN 'SERVICE_AGENT' THEN 'hierarchy-service-agent'
    WHEN 'TECHNICIAN' THEN 'hierarchy-technician'
    WHEN 'DISPATCH' THEN 'hierarchy-dispatch'
    ELSE NULL
END;
