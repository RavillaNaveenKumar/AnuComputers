-- Existing native and generic CRM records should have an owner where an
-- accountable creator is available; fall back to an active administrator.
WITH fallback_user AS (
  SELECT "id"
  FROM "User"
  WHERE "active" = true
  ORDER BY ("role" = 'ADMIN') DESC, "createdAt" ASC
  LIMIT 1
)
UPDATE "Customer" AS account
SET "ownerId" = COALESCE(
  (SELECT metadata."created_by_id"
   FROM "crm_native_record_metadata" AS metadata
   WHERE metadata."object_api_name" = 'Account'
     AND metadata."record_id" = account."id"
     AND metadata."created_by_id" IS NOT NULL),
  (SELECT "id" FROM fallback_user)
)
WHERE account."ownerId" IS NULL;

WITH fallback_user AS (
  SELECT "id"
  FROM "User"
  WHERE "active" = true
  ORDER BY ("role" = 'ADMIN') DESC, "createdAt" ASC
  LIMIT 1
)
UPDATE "Lead" AS lead
SET "assigneeId" = COALESCE(
  (SELECT metadata."created_by_id"
   FROM "crm_native_record_metadata" AS metadata
   WHERE metadata."object_api_name" = 'Lead'
     AND metadata."record_id" = lead."id"
     AND metadata."created_by_id" IS NOT NULL),
  (SELECT "id" FROM fallback_user)
)
WHERE lead."assigneeId" IS NULL;

WITH fallback_user AS (
  SELECT "id"
  FROM "User"
  WHERE "active" = true
  ORDER BY ("role" = 'ADMIN') DESC, "createdAt" ASC
  LIMIT 1
)
UPDATE "crm_records" AS record
SET "owner_id" = COALESCE(record."created_by_id", (SELECT "id" FROM fallback_user))
FROM "crm_objects" AS object
WHERE record."object_id" = object."id"
  AND object."api_name" = 'Opportunity'
  AND record."owner_id" IS NULL;
