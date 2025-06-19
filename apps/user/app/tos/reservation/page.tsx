import { useTranslations } from 'next-intl'
import TermsEN from './TermsEN'
import TermsES from './TermsES'
import TermsFI from './TermsFI'

export default function ReservationTosPage() {

  const t = useTranslations('TermsOfService')
  const tosKey = t('tos')

  console.log('tosKey', tosKey)

  const versions: {
    [key: string]: JSX.Element;
  } = {
    'terms-en': <TermsEN />,
    'terms-es': <TermsES />,
    'terms-fi': <TermsFI />
  }

  return (
    <div className="absolute top-0 left-0 w-full h-full bg-white z-50 text-[14px] flex flex-col">
      <div className="flex-1 overflow-auto p-[6px]">
        { versions[t('tos')] }
      </div>
    </div>
  )
}