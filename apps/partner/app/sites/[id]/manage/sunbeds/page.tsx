import ManagementView from '../view'
import ErrorCard from '@/components/ErrorCard'
import { loadManageGrid } from '../load-grid'


export default async function ManageSunbedsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string }>
}) {
  const { id } = await params
  const { key } = await searchParams

  const result = await loadManageGrid(id, key)
  if (!result.ok) {
    return (
      <ErrorCard
        title={result.error.title}
        message={result.error.message}
        showBackLink={false}
      />
    )
  }

  const backHref = `/sites/${id}/manage?key=${key}`

  return (
    <div className="w-screen">
      <ManagementView
        site={result.site}
        accessKey={key!}
        employees={result.employees}
        backHref={backHref}
      />
    </div>
  )
}
