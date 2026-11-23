-- AlterTable
ALTER TABLE "products" ADD COLUMN     "focusKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaTitle" TEXT;
