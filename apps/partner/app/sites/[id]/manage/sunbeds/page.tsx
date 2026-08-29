import ManagementView from '../view'
import ErrorCard from '@/components/ErrorCard'
import { loadManageGrid } from '../load-grid'


export default async function ManageSunbedsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { [key: string]: string }
}) {
  const { key } = searchParams

  const result = await loadManageGrid(params.id, key)
  if (!result.ok) {
    return (
      <ErrorCard
        title={result.error.title}
        message={result.error.message}
        showBackLink={false}
      />
    )
  }

  const backHref = `/sites/${params.id}/manage?key=${key}`

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
