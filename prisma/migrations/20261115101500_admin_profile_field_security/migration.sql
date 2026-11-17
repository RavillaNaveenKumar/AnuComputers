UPDATE "crm_profile_field_permissions" profile_field
SET "visible" = true,
    "editable" = field."data_type"::text <> 'AUTO_NUMBER'
FROM "crm_profiles" profile
JOIN "crm_fields" field ON true
WHERE profile_field."profile_id" = profile."id"
  AND profile_field."field_id" = field."id"
  AND profile."key" = 'system-administrator';
