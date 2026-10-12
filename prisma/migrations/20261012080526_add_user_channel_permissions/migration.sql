-- CreateTable
CREATE TABLE "user_channel_permissions" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "user_channel_permissions_pkey" PRIMARY KEY ("userId","channelId","permissionId")
);

-- AddForeignKey
ALTER TABLE "user_channel_permissions" ADD CONSTRAINT "user_channel_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_channel_permissions" ADD CONSTRAINT "user_channel_permissions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_channel_permissions" ADD CONSTRAINT "user_channel_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
