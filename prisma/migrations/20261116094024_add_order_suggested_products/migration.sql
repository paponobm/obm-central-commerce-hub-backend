-- CreateTable
CREATE TABLE "order_suggested_products" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_suggested_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_suggested_products_orderId_idx" ON "order_suggested_products"("orderId");

-- AddForeignKey
ALTER TABLE "order_suggested_products" ADD CONSTRAINT "order_suggested_products_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_suggested_products" ADD CONSTRAINT "order_suggested_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_suggested_products" ADD CONSTRAINT "order_suggested_products_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
