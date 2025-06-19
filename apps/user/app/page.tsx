import { auth } from '@/app/auth'
import { searchSites } from '@/service/siteService'
import SitesView from './view'

async function getSites() {
  return await searchSites()
}

export default async function Sites() {

  const { sites, geography } = await getSites()

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  
  return <SitesView sites={sites} geography={geography} apiKey={apiKey} />

}