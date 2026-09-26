-- CreateEnum
CREATE TYPE "CustomerResponseStatus" AS ENUM ('NO_RESPONSE', 'CALL_BACK', 'INTERESTED', 'NOT_INTERESTED', 'CONFIRMED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerResponse" "CustomerResponseStatus" NOT NULL DEFAULT 'NO_RESPONSE';
