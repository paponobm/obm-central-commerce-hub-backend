-- AlterTable
ALTER TABLE "products" ADD COLUMN     "forWho" TEXT[] DEFAULT ARRAY[]::TEXT[];
