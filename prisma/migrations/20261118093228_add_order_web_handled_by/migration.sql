-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "webHandledById" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_webHandledById_fkey" FOREIGN KEY ("webHandledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
