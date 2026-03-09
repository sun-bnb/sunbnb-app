-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "departed_at" TIMESTAMP(3),
ADD COLUMN     "guest_contact" TEXT,
ADD COLUMN     "guest_name" TEXT,
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "operational_status" TEXT NOT NULL DEFAULT 'expected',
ADD COLUMN     "reminder_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "no_show_deadline_minutes" INTEGER;
