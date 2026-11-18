-- DropIndex
DROP INDEX "categories_slug_key";

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");
