-- Keep the relationship in OpportunityId; task subjects should remain readable.
UPDATE "crm_records" AS task
SET "data" = jsonb_set(
  task."data",
  '{Name}',
  to_jsonb(regexp_replace(task."data" ->> 'Name', ' \[[^]]+\]$', ''))
)
FROM "crm_objects" AS object
WHERE task."object_id" = object."id"
  AND object."api_name" = 'Task'
  AND task."data" ->> 'Name' ~ ' \[[^]]+\]$';
