-- AlterTable
ALTER TABLE "RentalBooking" ADD COLUMN     "employee_id" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "employee_id" TEXT;

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TillClose" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "txn_count" INTEGER NOT NULL,

    CONSTRAINT "TillClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_account_id_idx" ON "Employee"("account_id");

-- CreateIndex
CREATE INDEX "TillClose_site_id_employee_id_idx" ON "TillClose"("site_id", "employee_id");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillClose" ADD CONSTRAINT "TillClose_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillClose" ADD CONSTRAINT "TillClose_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
