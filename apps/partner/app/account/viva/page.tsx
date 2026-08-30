import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import VivaView from './view'

export default async function VivaPage({ searchParams }: { searchParams: { [key: string]: string } }) {
  const session = await auth()
  if (!session?.user) return null

  const account = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    select: {
      email: true,
      vivaAccountId: true,
      vivaMerchantId: true,
      vivaVerificationStatus: true,
      vivaConnectedAt: true,
    },
  })

  return (
    <VivaView
      isConnected={!!account?.vivaAccountId}
      verificationStatus={account?.vivaVerificationStatus ?? null}
      merchantId={account?.vivaMerchantId ?? null}
      connectedAt={account?.vivaConnectedAt ? account.vivaConnectedAt.toISOString() : null}
      email={account?.email ?? null}
      connected={searchParams.connected === '1'}
    />
  )
}
