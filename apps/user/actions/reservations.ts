'use server';

import { auth } from '@/app/auth';
import { Reservation, ServiceFee } from '@prisma/client';
import prisma from '@repo/data/PrismaCient';

function round(amount: number) {
  return Math.round(amount * 100) / 100;
}

function computeVatAndBaseAmounts(finalAmount: number, vatRate: number) {
  const baseAmount = round(finalAmount / (1 + vatRate / 100))
  const vatAmount = round(finalAmount - baseAmount);
  return { baseAmount, vatAmount };
}

async function ensureAuthenticatedUser() {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  return session;
}

async function fetchReservation(id: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { 
      items: true,
      site: true 
    }
  });
  if (!reservation) {
    throw new Error(`Reservation not found for id: ${id}`);
  }
  return reservation;
}

function findServiceFee(
  site: any,
  partnerAccount: any,
  settings: any,
  serviceCode: string
): ServiceFee | undefined {
  return (
    site?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode) ||
    partnerAccount?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode) ||
    settings?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode)
  );
}



async function handleConfirmedReservation(reservation: any) {

  console.log('HANDLE CONFIRMED RESERVATION', reservation)

  let [site, partnerAccount, settings] = await Promise.all([
    prisma.site.findUnique({
      where: { id: reservation.siteId },
      include: { serviceFees: true },
    }),
    prisma.partnerAccount.findUnique({
      where: { userId: reservation.site.userId },
      include: { serviceFees: true },
    }),
    prisma.settings.findFirst({
      include: { serviceFees: true },
    }),
  ]);

  if (!settings) {
    
    await prisma.settings.create({
      data: {
        country: 'FI',
        currency: 'EUR',
        vat: 25.5
      }
    })
    
    settings = await prisma.settings.findFirst({
      include: { serviceFees: true },
    })

    await prisma.serviceFee.create({
      data: {
        settingsId: settings?.id!,
        serviceCode: 'sunbed-rental',
        chargeType: 'fixed',
        feeAmount: 1.00
      }
    })

  }

  const SERVICE_CODE = 'sunbed-rental';
  const matchedServiceFee = findServiceFee(site, partnerAccount, settings, SERVICE_CODE);

  console.log('MATCHED SERVICE FEE', matchedServiceFee)

  const totalFinalAmount = reservation.paymentAmount ?? 0;
  const vatRate = site?.vat ?? 0;
  const { baseAmount: totalBaseAmount, vatAmount: totalVatAmount } = 
    computeVatAndBaseAmounts(totalFinalAmount, vatRate);

  const invoice = await prisma.invoice.create({
    data: {
      accountId: partnerAccount?.userId || '',
      totalCharge: totalBaseAmount,
      totalTax: totalVatAmount,
      totalAmount: totalFinalAmount,
    },
  })

  let invoiceLines = reservation.items.map((item: any) => {

    const finalAmount = item.price ?? site?.price ?? 0;
    const serviceFeeAmount = matchedServiceFee?.chargeType === 'fixed' ?
      matchedServiceFee?.feeAmount : matchedServiceFee?.percentage! * finalAmount
    const itemAmount = finalAmount - (serviceFeeAmount || 0)

    const { baseAmount: itemBaseAmount, vatAmount: itemVatAmount } = computeVatAndBaseAmounts(itemAmount, vatRate);
    const { baseAmount: serviceBaseAmount, vatAmount: serviceVatAmount } = computeVatAndBaseAmounts(serviceFeeAmount || 0, vatRate);

    return [
      {
        charge: itemBaseAmount,
        tax: itemVatAmount,
        amount: itemAmount,
        invoiceId: invoice.id,
        productCode: 'sunbed-rental',
        description: `Sunbed ${item.number} (${item.category})`
      },
      {
        charge: serviceBaseAmount,
        tax: serviceVatAmount,
        amount: serviceFeeAmount,
        invoiceId: invoice.id,
        productCode: 'sunbnb-service-fee',
        description: `Res. fee`
      }
    ]

  });

  invoiceLines = invoiceLines.flat()

  if (invoiceLines.length > 0) {
    await prisma.invoiceLine.createMany({ data: invoiceLines });
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        invoiceId: invoice.id,
        status: 'paid'
      },
    });
  }
}

export async function updateReservation({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  try {
    const session = await ensureAuthenticatedUser();
    console.log('SAVE RESERVATION', { session, id, status });

    let savedReservation = await fetchReservation(id);

    console.log('SAVED RESERVATION', savedReservation);

    if (savedReservation.status === 'paid') {
      return { status: 'ok', id };
    }

    await prisma.reservation.update({
      where: { id },
      data: { status },
    });

    if (savedReservation.status === 'confirmed') {
      await handleConfirmedReservation(savedReservation);
    }

    console.log('UPDATED RESERVATION', id);
    return { status: 'ok', id };
  } catch (error: any) {
    console.error('UPDATE RESERVATION ERROR:', error);
    return { status: 'error', errors: [error.message] };
  }
}
