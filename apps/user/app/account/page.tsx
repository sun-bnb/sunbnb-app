import { auth } from '@/app/auth'
import { PrismaClient } from '@prisma/client'
import { AccountProps } from './view'
import AccountView from './view'

const prisma = new PrismaClient()
  
  
export default async function Account() {

  const session = await auth()

  if (!session) return null
  const { user } = session

  let account: AccountProps | null = await prisma.partnerAccount.findUnique({ where: { userId: user.id } })

  if (!account) {
    const [ firstName, lastName ] = user.name.split(' ')
    account = {
      firstName,
      lastName,
      email: user.email,
      phoneNumber: '',
      company: '',
      websiteUrl: '',
      address: '',
      bankAccount: ''
    }

  }
  
  return <AccountView account={account} />

}