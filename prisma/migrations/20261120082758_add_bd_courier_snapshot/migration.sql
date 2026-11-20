-- AlterTable
ALTER TABLE "checkout_leads" ADD COLUMN     "bdCourierCheckedAt" TIMESTAMP(3),
ADD COLUMN     "bdCourierCheckedPhone" TEXT,
ADD COLUMN     "bdCourierResult" JSONB;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bdCourierCheckedAt" TIMESTAMP(3),
ADD COLUMN     "bdCourierCheckedPhone" TEXT,
ADD COLUMN     "bdCourierResult" JSONB;
