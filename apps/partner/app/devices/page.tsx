import { getFleet, getAssignableSites } from './queries'
import DevicesView from './view'

export default async function DevicesPage() {
  const [devices, sites] = await Promise.all([getFleet(), getAssignableSites()])
  return <DevicesView devices={devices} sites={sites} />
}
