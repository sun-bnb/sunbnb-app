import ErrorCard from '@/components/ErrorCard'
import TrendsView from './TrendsView'
import { validateManageToken } from '../token'

export default async function ManageTrendsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { [key: string]: string }
}) {
  const { key } = searchParams

  const result = await validateManageToken(params.id, key)
  if (!result.ok) {
    return (
      <ErrorCard
        title={result.error.title}
        message={result.error.message}
        showBackLink={false}
      />
    )
  }

  if (!result.isAdmin) {
    return (
      <ErrorCard
        title="Admin access required"
        message="This page is only accessible with an admin token."
        showBackLink={false}
      />
    )
  }

  const backHref = `/sites/${params.id}/manage?key=${key}`

  return (
    <TrendsView
      siteId={result.site.id}
      accessKey={key!}
      siteName={result.site.name}
      backHref={backHref}
    />
  )
}
