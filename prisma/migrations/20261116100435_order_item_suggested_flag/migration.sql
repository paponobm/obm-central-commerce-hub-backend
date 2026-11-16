/*
  Warnings:

  - You are about to drop the `order_suggested_products` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "order_suggested_products" DROP CONSTRAINT "order_suggested_products_createdById_fkey";

-- DropForeignKey
ALTER TABLE "order_suggested_products" DROP CONSTRAINT "order_suggested_products_orderId_fkey";

-- DropForeignKey
ALTER TABLE "order_suggested_products" DROP CONSTRAINT "order_suggested_products_productId_fkey";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "isSuggested" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "order_suggested_products";
