-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "customerResponse" DROP NOT NULL,
ALTER COLUMN "customerResponse" DROP DEFAULT;

-- Backfill: orders whose response was never set (no logged change) go back to
-- an empty response, so new storefront orders wait in Processing.
UPDATE "orders" o
SET "customerResponse" = NULL
WHERE o."customerResponse" = 'NO_RESPONSE'
  AND NOT EXISTS (
    SELECT 1 FROM "audit_logs" a
    WHERE a."action" = 'order.customer_response_change'
      AND a."entityType" = 'Order'
      AND a."entityId" = o."id"
  );
