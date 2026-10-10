import ErrorCard from '@/components/ErrorCard'
import ManageLanding from './ManageLanding'
import { validateManageToken } from './token'


export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string }>
}) {
  const { id } = await params
  const { key } = await searchParams

  const result = await validateManageToken(id, key)
  if (!result.ok) {
    return (
      <ErrorCard
        title={result.error.title}
        message={result.error.message}
        showBackLink={false}
      />
    )
  }

  return (
    <ManageLanding
      siteId={result.site.id}
      siteName={result.site.name}
      accessKey={key!}
      isAdmin={result.isAdmin}
    />
  )
}
