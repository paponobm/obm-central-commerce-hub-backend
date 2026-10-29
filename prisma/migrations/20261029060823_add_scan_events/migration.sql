-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('RTS', 'SHIPPING', 'RETURN');

-- CreateTable
CREATE TABLE "scan_events" (
    "id" TEXT NOT NULL,
    "mode" "ScanMode" NOT NULL,
    "query" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus",
    "success" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "channelId" TEXT,
    "provider" "IntegrationProvider",
    "scannedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_events_createdAt_idx" ON "scan_events"("createdAt");

-- CreateIndex
CREATE INDEX "scan_events_channelId_idx" ON "scan_events"("channelId");
