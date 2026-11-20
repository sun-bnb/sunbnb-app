import { ContentPageView, contentMetadata, contentStaticParams } from '@/components/ContentPage'

type Props = { params: Promise<{ slug: string }> }

/** /guias/<slug>: a Spanish content page from lib/content-pages.ts (CR-003). Unknown slugs 404. */
export const dynamicParams = false

export function generateStaticParams() {
  return contentStaticParams('guias')
}

export async function generateMetadata({ params }: Props) {
  return contentMetadata('guias', (await params).slug)
}

export default async function Page({ params }: Props) {
  return <ContentPageView section="guias" slug={(await params).slug} />
}
