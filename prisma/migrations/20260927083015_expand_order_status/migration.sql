-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_RETURN';
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_CANCEL';
ALTER TYPE "OrderStatus" ADD VALUE 'PREORDER';
ALTER TYPE "OrderStatus" ADD VALUE 'LOST';
