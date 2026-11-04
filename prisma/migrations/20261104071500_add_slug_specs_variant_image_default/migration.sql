-- AlterTable
ALTER TABLE "products" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "specifications" JSONB;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
