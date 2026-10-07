-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "webApprovedAt" TIMESTAMP(3);

-- Backfill: website orders already approved before this column existed.
UPDATE "orders" o
SET "webApprovedAt" = a."createdAt"
FROM "audit_logs" a
WHERE a."action" = 'order.web_approved'
  AND a."entityType" = 'Order'
  AND a."entityId" = o."id"
  AND o."webApprovedAt" IS NULL;
