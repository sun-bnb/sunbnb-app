import { ContentPageView, contentMetadata, contentStaticParams } from '@/components/ContentPage'

type Props = { params: Promise<{ slug: string }> }

/** /es/<slug>: a Spanish content page from lib/content-pages.ts (CR-003). Unknown slugs 404. */
export const dynamicParams = false

export function generateStaticParams() {
  return contentStaticParams('es')
}

export async function generateMetadata({ params }: Props) {
  return contentMetadata('es', (await params).slug)
}

export default async function Page({ params }: Props) {
  return <ContentPageView section="es" slug={(await params).slug} />
}
