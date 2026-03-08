import prisma from '../index'

export type BusinessEntity = {
  companyName: string
  companyAddress: string
  businessId: string
  vatId: string
  contactEmail: string
  contactPhone: string
  vatRate: number
}

const DEFAULTS: BusinessEntity = {
  companyName: 'Platform Operator',
  companyAddress: '',
  businessId: '',
  vatId: '',
  contactEmail: 'info@sunbnb.app',
  contactPhone: '',
  vatRate: 25.5,
}

export async function getBusinessEntity(): Promise<BusinessEntity> {
  const settings = await prisma.settings.findFirst({
    select: {
      companyName: true,
      companyAddress: true,
      businessId: true,
      vatId: true,
      contactEmail: true,
      contactPhone: true,
      vat: true,
    },
  })

  return {
    companyName: settings?.companyName || DEFAULTS.companyName,
    companyAddress: settings?.companyAddress || DEFAULTS.companyAddress,
    businessId: settings?.businessId || DEFAULTS.businessId,
    vatId: settings?.vatId || DEFAULTS.vatId,
    contactEmail: settings?.contactEmail || DEFAULTS.contactEmail,
    contactPhone: settings?.contactPhone || DEFAULTS.contactPhone,
    vatRate: settings?.vat ?? DEFAULTS.vatRate,
  }
}
