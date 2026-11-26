-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_sortOrder_idx" ON "products"("sortOrder");
