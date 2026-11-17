ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

WITH user_names AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(LEFT(REGEXP_REPLACE(LOWER(SPLIT_PART("email", '@', 1)), '[^a-z0-9_]', '', 'g'), 22), ''),
      'user'
    ) AS base_username,
    SPLIT_PART("name", ' ', 1) AS first_name,
    NULLIF(REGEXP_REPLACE("name", '^\S+\s*', ''), '') AS last_name
  FROM "User"
)
UPDATE "User" AS users
SET
  "username" = names.base_username || '_' || SUBSTRING(MD5(users."id") FROM 1 FOR 6),
  "firstName" = names.first_name,
  "lastName" = names.last_name
FROM user_names AS names
WHERE users."id" = names."id";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_lower_key" ON "User"(LOWER("email"));

CREATE TABLE "LoginHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "identifier" TEXT,
  "success" BOOLEAN NOT NULL,
  "failureReason" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginHistory_userId_createdAt_idx" ON "LoginHistory"("userId", "createdAt");
CREATE INDEX "LoginHistory_createdAt_idx" ON "LoginHistory"("createdAt");
ALTER TABLE "LoginHistory"
  ADD CONSTRAINT "LoginHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
