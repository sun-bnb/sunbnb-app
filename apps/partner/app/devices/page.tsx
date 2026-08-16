import { getFleet } from './queries'
import DevicesView from './view'

export default async function DevicesPage() {
  const devices = await getFleet()
  return <DevicesView devices={devices} />
}
