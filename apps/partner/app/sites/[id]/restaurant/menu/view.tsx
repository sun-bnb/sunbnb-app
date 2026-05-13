'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MenuEditor, type MenuEditorLabels } from '@repo/table-reservations-ui'
import type { MenuItemRecord } from '@repo/table-reservations-core'
import { useSite } from '@/app/sites/site-context'
import { getLinkedRestaurantMenu } from '../queries'
import {
  createMenuItemForSite,
  updateMenuItemForSite,
  archiveMenuItemForSite,
  setMenuItemSoldOutForSite,
  reorderMenuItemsForSite,
} from './actions'
import { RestaurantSubNav } from '../RestaurantSubNav'

export default function MenuView() {
  const t = useTranslations('Restaurant')
  const { site } = useSite()
  const siteId = site.id || ''

  const [items, setItems] = useState<MenuItemRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const list = await getLinkedRestaurantMenu(siteId)
    setItems(list ?? [])
  }, [siteId])

  useEffect(() => {
    if (!site.restaurantId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    getLinkedRestaurantMenu(siteId).then((list) => {
      setItems(list ?? [])
      setLoading(false)
    })
  }, [site.restaurantId, siteId])

  if (!site.restaurantId) {
    return (
      <div className="pt-2">
        <RestaurantSubNav siteId={siteId} active="menu" />
        <div className="p-4 text-sm text-gray-500">{t('menuRequiresEnable')}</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="pt-2">
        <RestaurantSubNav siteId={siteId} active="menu" />
        <div className="p-4 text-sm text-gray-500">{t('loading')}</div>
      </div>
    )
  }

  const labels: MenuEditorLabels = {
    addItem: t('menuAddItem'),
    emptyTitle: t('menuEmptyTitle'),
    emptyHint: t('menuEmptyHint'),
    categoryFallback: t('menuCategoryFallback'),
    dialog: {
      titleCreate: t('menuDialogCreate'),
      titleEdit: t('menuDialogEdit'),
      fieldName: t('menuFieldName'),
      fieldDescription: t('menuFieldDescription'),
      fieldPrice: t('menuFieldPrice'),
      fieldCategory: t('menuFieldCategory'),
      fieldCategoryHelper: t('menuFieldCategoryHelper'),
      imageCurrent: t('menuImageChange'),
      imagePick: t('menuImagePick'),
      imageRemove: t('menuImageRemove'),
      cancel: t('cancel'),
      save: t('menuSave'),
      saving: t('saving'),
      errorPrefix: t('errorPrefix'),
    },
    row: {
      soldOutTitle: t('menuSoldOutTitle'),
      edit: t('menuRowEdit'),
      archive: t('menuRowArchive'),
      moveUp: t('menuRowMoveUp'),
      moveDown: t('menuRowMoveDown'),
      soldOutBadge: t('menuSoldOutBadge'),
      currencyPrefix: t('menuCurrencyPrefix'),
    },
  }

  return (
    <div className="pt-2">
      <RestaurantSubNav siteId={siteId} active="menu" />
      <div className="p-4">
        <MenuEditor
          items={items}
          labels={labels}
          onCreate={async (values) => {
            const fd = new FormData()
            fd.set('name', values.name)
            fd.set('description', values.description)
            fd.set('price', String(values.price))
            fd.set('category', values.category)
            if (values.imageFile) fd.set('imageFile', values.imageFile)
            if (values.imageUrl) fd.set('imageUrl', values.imageUrl)
            const res = await createMenuItemForSite(siteId, fd)
            if (res.status === 'ok') await refresh()
            return res
          }}
          onUpdate={async (id, values) => {
            const fd = new FormData()
            fd.set('name', values.name)
            fd.set('description', values.description)
            fd.set('price', String(values.price))
            fd.set('category', values.category)
            if (values.imageFile) fd.set('imageFile', values.imageFile)
            else if (values.imageUrl === null) fd.set('removeImage', '1')
            else if (values.imageUrl) fd.set('imageUrl', values.imageUrl)
            const res = await updateMenuItemForSite(siteId, id, fd)
            if (res.status === 'ok') await refresh()
            return res
          }}
          onArchive={async (id) => {
            const res = await archiveMenuItemForSite(siteId, id)
            if (res.status === 'ok') await refresh()
            return res
          }}
          onToggleSoldOut={async (id, soldOut) => {
            const res = await setMenuItemSoldOutForSite(siteId, id, soldOut)
            if (res.status === 'ok') await refresh()
            return res
          }}
          onReorder={async (ids) => {
            const res = await reorderMenuItemsForSite(siteId, ids)
            if (res.status === 'ok') await refresh()
            return res
          }}
        />
      </div>
    </div>
  )
}
