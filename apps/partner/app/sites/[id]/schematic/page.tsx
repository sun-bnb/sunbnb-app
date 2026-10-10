import SitePage from '@/app/sites/site-page'

import SchematicView from './view'

export default async function SchematicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <SitePage params={{ id }} tab="schematic">
      <SchematicView />
    </SitePage>
  )
}
