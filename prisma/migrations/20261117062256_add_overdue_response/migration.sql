-- CreateEnum
CREATE TYPE "OverdueResponse" AS ENUM ('CUSTOMER_CONFIRM', 'NO_RESPONSE', 'CUSTOMER_REFUSED', 'COURIER_CLAIM');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "overdueResponse" "OverdueResponse";
