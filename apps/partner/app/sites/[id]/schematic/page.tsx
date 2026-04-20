import SitePage from '@/app/sites/site-page'

import SchematicView from './view'

export default async function SchematicPage({ params }: { params: { id: string } }) {
  return (
    <SitePage params={params} tab="schematic">
      <SchematicView />
    </SitePage>
  )
}
