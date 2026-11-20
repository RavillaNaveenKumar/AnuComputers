-- Older records could be left in Assigned after an assignee was removed.
-- Keep the records and history intact, but return them to the truthful
-- unassigned state so they can be assigned through the normal workflow.
UPDATE "ServiceTicket"
SET "status" = 'NEW', "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'ASSIGNED'
  AND "assigneeId" IS NULL;
