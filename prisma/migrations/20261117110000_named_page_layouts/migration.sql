ALTER TABLE "crm_page_layouts"
  DROP CONSTRAINT IF EXISTS "crm_page_layouts_object_id_key";
DROP INDEX IF EXISTS "crm_page_layouts_object_id_key";

ALTER TABLE "crm_page_layouts"
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "required_field_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "read_only_field_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "crm_page_layouts" AS layout
SET "is_default" = true,
    "name" = CASE WHEN layout."name" = 'Record Layout' THEN object."name" || ' Layout' ELSE layout."name" END
FROM "crm_objects" AS object
WHERE layout."object_id" = object."id";

CREATE UNIQUE INDEX "crm_page_layouts_object_id_name_key"
  ON "crm_page_layouts"("object_id", "name");
CREATE UNIQUE INDEX "crm_page_layouts_one_default_per_object_key"
  ON "crm_page_layouts"("object_id") WHERE "is_default" = true;
CREATE UNIQUE INDEX "crm_page_layouts_id_object_id_key"
  ON "crm_page_layouts"("id", "object_id");

INSERT INTO "crm_page_layouts" (
  "id", "object_id", "name", "is_default", "revision", "field_order",
  "hidden_field_ids", "sections", "related_lists", "detail_tabs", "updated_at"
)
SELECT
  'layout_' || md5(object."id"), object."id", object."name" || ' Layout', true, 1,
  COALESCE(array_agg(field."id" ORDER BY field."position") FILTER (WHERE field."id" IS NOT NULL), ARRAY[]::text[]),
  ARRAY[]::text[], '[]'::jsonb, ARRAY[]::text[], '[]'::jsonb, CURRENT_TIMESTAMP
FROM "crm_objects" AS object
LEFT JOIN "crm_fields" AS field ON field."object_id" = object."id" AND field."active" = true
WHERE NOT EXISTS (SELECT 1 FROM "crm_page_layouts" layout WHERE layout."object_id" = object."id")
GROUP BY object."id", object."name";

CREATE TABLE "crm_page_layout_assignments" (
  "id" TEXT NOT NULL,
  "object_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "record_type_key" TEXT NOT NULL DEFAULT 'MASTER',
  "layout_id" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_page_layout_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_page_layout_assignments_object_id_profile_id_record_type_key_key"
  ON "crm_page_layout_assignments"("object_id", "profile_id", "record_type_key");
CREATE INDEX "crm_page_layout_assignments_layout_id_idx"
  ON "crm_page_layout_assignments"("layout_id");
ALTER TABLE "crm_page_layout_assignments"
  ADD CONSTRAINT "crm_page_layout_assignments_object_id_fkey"
    FOREIGN KEY ("object_id") REFERENCES "crm_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_page_layout_assignments_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "crm_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "crm_page_layout_assignments_layout_object_fkey"
    FOREIGN KEY ("layout_id", "object_id") REFERENCES "crm_page_layouts"("id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;
