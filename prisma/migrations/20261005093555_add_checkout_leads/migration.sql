-- CreateTable
CREATE TABLE "checkout_leads" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_leads_channelId_phone_key" ON "checkout_leads"("channelId", "phone");

-- AddForeignKey
ALTER TABLE "checkout_leads" ADD CONSTRAINT "checkout_leads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
