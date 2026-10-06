-- AlterTable
ALTER TABLE "checkout_leads" ALTER COLUMN "customerResponse" DROP NOT NULL,
ALTER COLUMN "customerResponse" DROP DEFAULT;
