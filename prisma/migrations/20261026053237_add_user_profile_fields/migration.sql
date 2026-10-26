-- AlterTable
ALTER TABLE "users" ADD COLUMN     "about" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "designation" TEXT,
ADD COLUMN     "employeeCode" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "joiningDate" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "shift" TEXT;
