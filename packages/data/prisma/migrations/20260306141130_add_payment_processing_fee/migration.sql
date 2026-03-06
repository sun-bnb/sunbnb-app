-- CreateTable
CREATE TABLE "PaymentProcessingFee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "fixed_amount" DOUBLE PRECISION,
    "percentage" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProcessingFee_pkey" PRIMARY KEY ("id")
);
