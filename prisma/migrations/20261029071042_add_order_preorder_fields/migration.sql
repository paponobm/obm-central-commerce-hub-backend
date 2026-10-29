-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "preorderNotifyAt" TIMESTAMP(3),
ADD COLUMN     "preorderReason" TEXT;
