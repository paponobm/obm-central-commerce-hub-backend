/*
  Warnings:

  - You are about to drop the `coupon_redemptions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_channelId_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_orderId_fkey";

-- DropTable
DROP TABLE "coupon_redemptions";

-- CreateTable
CREATE TABLE "vip_coupons" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "grantedOrderId" TEXT NOT NULL,
    "usedOrderId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vip_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vip_coupons_code_key" ON "vip_coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vip_coupons_grantedOrderId_key" ON "vip_coupons"("grantedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "vip_coupons_usedOrderId_key" ON "vip_coupons"("usedOrderId");

-- CreateIndex
CREATE INDEX "vip_coupons_channelId_idx" ON "vip_coupons"("channelId");

-- AddForeignKey
ALTER TABLE "vip_coupons" ADD CONSTRAINT "vip_coupons_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_coupons" ADD CONSTRAINT "vip_coupons_grantedOrderId_fkey" FOREIGN KEY ("grantedOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_coupons" ADD CONSTRAINT "vip_coupons_usedOrderId_fkey" FOREIGN KEY ("usedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
