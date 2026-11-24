-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "expiryAlertDays" INTEGER,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "manufacturingDate" TIMESTAMP(3);
