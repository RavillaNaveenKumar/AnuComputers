UPDATE "User" AS users
SET "lastLoginAt" = sessions.last_login_at
FROM (
  SELECT "userId", MAX("createdAt") AS last_login_at
  FROM "Session"
  GROUP BY "userId"
) AS sessions
WHERE users."id" = sessions."userId"
  AND users."lastLoginAt" IS NULL;
