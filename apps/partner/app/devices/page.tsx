import { getFleet, getAssignableSites, getPlatformPolicy } from './queries'
import DevicesView from './view'

export default async function DevicesPage() {
  const [devices, sites, platformPolicy] = await Promise.all([
    getFleet(),
    getAssignableSites(),
    getPlatformPolicy(),
  ])
  return <DevicesView devices={devices} sites={sites} platformPolicy={platformPolicy} />
}
