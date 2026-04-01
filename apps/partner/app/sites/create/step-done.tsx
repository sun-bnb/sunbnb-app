'use client'

import React from 'react'
import Button from '@mui/material/Button'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { WizardData } from './create-site-wizard'

export default function StepDone({ data }: { data: WizardData }) {

  const t = useTranslations('SiteCreate')

  return (
    <div className="flex flex-col items-center py-8">
      <CheckCircleIcon sx={{ fontSize: 64, color: '#22c55e', mb: 2 }} />
      <h2 className="text-xl font-semibold text-gray-800 mb-2">{t('siteCreated')}</h2>
      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
        <strong>{data.name}</strong> {t('siteCreatedDescription')}
      </p>
      <div className="flex gap-3">
        <Link href={`/sites/${data.siteId}/general`}>
          <Button variant="contained" sx={{ textTransform: 'none' }}>
            {t('goToSettings')}
          </Button>
        </Link>
        <Link href={`/sites/${data.siteId}/inventory`}>
          <Button variant="outlined" sx={{ textTransform: 'none' }}>
            {t('setUpInventory')}
          </Button>
        </Link>
      </div>
    </div>
  )
}
