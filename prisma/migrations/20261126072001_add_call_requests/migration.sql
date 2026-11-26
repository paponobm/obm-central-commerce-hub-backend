-- CreateEnum
CREATE TYPE "CallRequestStatus" AS ENUM ('PENDING', 'SOLVED');

-- CreateTable
CREATE TABLE "call_requests" (
    "id" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "status" "CallRequestStatus" NOT NULL DEFAULT 'PENDING',
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_requests_requestCode_key" ON "call_requests"("requestCode");

-- CreateIndex
CREATE INDEX "call_requests_status_idx" ON "call_requests"("status");

-- AddForeignKey
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
