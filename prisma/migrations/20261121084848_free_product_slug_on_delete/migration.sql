-- DropIndex
DROP INDEX "product_channels_channelId_slug_key";

-- DropIndex
DROP INDEX "products_slug_key";

-- CreateIndex
CREATE INDEX "product_channels_channelId_slug_idx" ON "product_channels"("channelId", "slug");

-- CreateIndex
CREATE INDEX "products_slug_idx" ON "products"("slug");
