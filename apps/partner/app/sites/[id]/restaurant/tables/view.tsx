'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  TableLayoutEditor,
  type TableLayoutEditorLabels,
} from '@repo/table-reservations-ui'
import type {
  LayoutElementRecord,
  TableInput,
  TableRecord,
} from '@repo/table-reservations-core'
import { RESTAURANT_ELEMENT_PRESETS } from '@repo/table-reservations-ui'
import {
  SaveStatusBanner,
  CanvasDimensionsHeader,
  type SaveStatus,
} from '@repo/schematic-editor'
import { useSite } from '@/app/sites/site-context'
import { getLinkedRestaurantLayout, type LinkedRestaurantLayout } from '../queries'
import {
  createTableForSite,
  updateTableForSite,
  deleteTableForSite,
  duplicateTableForSite,
  createTableGridForSite,
  createElementForSite,
  updateElementForSite,
  deleteElementForSite,
  saveRestaurantDimensions,
} from './actions'
import { RestaurantSubNav } from '../RestaurantSubNav'

export default function TablesView() {
  const t = useTranslations('Restaurant')
  const tGeneral = useTranslations('SiteGeneral')
  const { site } = useSite()
  const siteId = site.id || ''

  const [layout, setLayout] = useState<LinkedRestaurantLayout | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const l = await getLinkedRestaurantLayout(siteId)
    setLayout(l)
  }, [siteId])

  useEffect(() => {
    if (!site.restaurantId) {
      setLayout(null)
      setLoading(false)
      return
    }
    setLoading(true)
    getLinkedRestaurantLayout(siteId).then((l) => {
      setLayout(l)
      setLoading(false)
    })
  }, [site.restaurantId, siteId])

  if (!site.restaurantId) {
    return (
      <div className="pt-2">
        <RestaurantSubNav siteId={siteId} active="tables" />
        <div className="p-4 text-sm text-gray-500">{t('tablesRequireEnable')}</div>
      </div>
    )
  }

  if (loading || !layout) {
    return (
      <div className="pt-2">
        <RestaurantSubNav siteId={siteId} active="tables" />
        <div className="p-4 text-sm text-gray-500">{t('loading')}</div>
      </div>
    )
  }

  const labels: TableLayoutEditorLabels = {
    palette: {
      surfacesHeading: t('paletteSurfaces'),
      objectsHeading: t('paletteObjects'),
      typeLabels: {
        dining: t('elementDining'),
        bar: t('elementBar'),
        kitchen: t('elementKitchen'),
        terrace: t('elementTerrace'),
        lounge: t('elementLounge'),
        reception: t('elementReception'),
        restroom: t('elementRestroom'),
        stage: t('elementStage'),
      },
    },
    tableForm: {
      heading: t('tableFormHeading'),
      number: t('tableFieldNumber'),
      label: t('tableFieldLabel'),
      capacity: t('tableFieldCapacity'),
      minPartySize: t('tableFieldMinPartySize'),
      maxPartySize: t('tableFieldMaxPartySize'),
      shape: t('tableFieldShape'),
      shapeSquare: t('shapeSquare'),
      shapeRound: t('shapeRound'),
      shapeRect: t('shapeRect'),
      shapeOval: t('shapeOval'),
      shapeBooth: t('shapeBooth'),
      shapeBar: t('shapeBar'),
      width: t('tableFieldWidth'),
      height: t('tableFieldHeight'),
      rotate: t('rotate'),
      zone: t('tableFieldZone'),
      staffNote: t('tableFieldStaffNote'),
      onlineBookable: t('tableFieldOnlineBookable'),
      turnTimeMinutes: t('tableFieldTurnTimeMinutes'),
      inheritsFromRestaurant: t('inheritsFromRestaurant'),
      locked: t('tableFieldLocked'),
      seatLayoutHeading: t('seatLayoutHeading'),
      seatTop: t('seatTop'),
      seatRight: t('seatRight'),
      seatBottom: t('seatBottom'),
      seatLeft: t('seatLeft'),
      seatLayoutAuto: t('seatLayoutAuto'),
      seatLayoutResetAuto: t('seatLayoutResetAuto'),
      seatLayoutSumMismatch: t('seatLayoutSumMismatch'),
      deleteTable: t('deleteTable'),
      close: t('close'),
    },
    gridDialog: {
      title: t('gridDialogTitle'),
      rows: t('gridRows'),
      cols: t('gridCols'),
      capacity: t('tableFieldCapacity'),
      shape: t('tableFieldShape'),
      shapeSquare: t('shapeSquare'),
      shapeRound: t('shapeRound'),
      shapeRect: t('shapeRect'),
      horizontalGap: t('gridHorizontalGap'),
      verticalGap: t('gridVerticalGap'),
      tableWidth: t('gridTableWidth'),
      tableHeight: t('gridTableHeight'),
      rotation: t('gridRotation'),
      cancel: t('cancel'),
      create: t('gridCreate'),
      creating: t('gridCreating'),
      errorPrefix: t('errorPrefix'),
    },
    addTable: t('addTable'),
    addGrid: t('addGrid'),
    emptyHint: t('clickCanvasToPlace'),
    bringForward: t('elementSidebarBringForward'),
    sendBackward: t('elementSidebarSendBackward'),
    editElement: t('editElement'),
    editTable: t('editTable'),
    duplicateTable: t('duplicateTable'),
    deleteElement: t('elementSidebarDelete'),
    deleteTable: t('deleteTable'),
    deselect: t('deselect'),
    elementSidebar: {
      heading: t('elementSidebarHeading'),
      elementType: t('elementSidebarType'),
      label: t('elementSidebarLabel'),
      width: t('elementSidebarWidth'),
      height: t('elementSidebarHeight'),
      rotation: t('elementSidebarRotation'),
      shape: t('elementSidebarShape'),
      shapeRect: t('elementSidebarShapeRect'),
      shapeEllipse: t('elementSidebarShapeEllipse'),
      cornerRadius: t('elementSidebarCornerRadius'),
      colorOverride: t('elementSidebarColor'),
      bringForward: t('elementSidebarBringForward'),
      sendBackward: t('elementSidebarSendBackward'),
      deleteElement: t('elementSidebarDelete'),
      close: t('close'),
      typeLabels: {
        dining: t('elementDining'),
        bar: t('elementBar'),
        kitchen: t('elementKitchen'),
        terrace: t('elementTerrace'),
        lounge: t('elementLounge'),
        reception: t('elementReception'),
        restroom: t('elementRestroom'),
        stage: t('elementStage'),
      },
    },
  }

  const trackSave = (status: SaveStatus, errors?: string[]) => {
    setSaveStatus(status)
    if (status === 'error') setSaveErrors(errors ?? [])
    else setSaveErrors([])
    if (status === 'saved') {
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }

  return (
    <div className="pt-2">
      <RestaurantSubNav siteId={siteId} active="tables" />
      <div className="p-4">
        <SaveStatusBanner
          status={saveStatus}
          labels={{
            saving: tGeneral('saving'),
            saved: tGeneral('allChangesSaved'),
            idle: tGeneral('upToDate'),
            error: tGeneral('errorSaving'),
          }}
          errorDetails={saveErrors.length > 0 ? saveErrors.join(', ') : undefined}
        />
        <div className="flex items-center justify-end mb-3">
          <CanvasDimensionsHeader
            width={layout.layoutWidth}
            height={layout.layoutHeight}
            labels={{
              width: t('canvasWidth'),
              height: t('canvasHeight'),
              metres: t('canvasMetres'),
            }}
            onSave={async (w, h) => {
              trackSave('saving')
              const res = await saveRestaurantDimensions(siteId, w, h)
              if (res.status === 'ok') {
                await refresh()
                trackSave('saved')
              } else {
                trackSave('error', res.errors)
              }
            }}
          />
        </div>
      <TableLayoutEditor
        worldWidth={layout.layoutWidth}
        worldHeight={layout.layoutHeight}
        tables={layout.tables as TableRecord[]}
        elements={layout.elements as LayoutElementRecord[]}
        labels={labels}
        onSaveStatusChange={trackSave}
        onTablePatch={async (tableId, patch) => {
          const res = await updateTableForSite(siteId, tableId, patch as Partial<TableInput>)
          if (res.status === 'ok') await refresh()
          return res
        }}
        onTableDelete={async (tableId) => {
          const res = await deleteTableForSite(siteId, tableId)
          if (res.status === 'ok') await refresh()
          return res
        }}
        onTableDuplicate={async (tableId) => {
          const res = await duplicateTableForSite(siteId, tableId)
          if (res.status === 'ok') await refresh()
          return res
        }}
        onTableCreate={async (at) => {
          const res = await createTableForSite(siteId, at)
          if (res.status === 'ok') await refresh()
          return res
        }}
        onTableGrid={async (input) => {
          const res = await createTableGridForSite(siteId, input)
          if (res.status === 'ok') await refresh()
          return res
        }}
        onElementCreate={async (at, type) => {
          const preset = RESTAURANT_ELEMENT_PRESETS[type]
          if (!preset) {
            return { status: 'error' as const, errors: ['Unknown element type'] }
          }
          const res = await createElementForSite(siteId, {
            type: preset.type,
            shape: preset.shape,
            x: at.x - preset.width / 2,
            y: at.y - preset.height / 2,
            width: preset.width,
            height: preset.height,
          })
          if (res.status === 'ok') await refresh()
          return res
        }}
        onElementPatch={async (elementId, patch) => {
          const res = await updateElementForSite(siteId, elementId, patch as Partial<{
            type: string
            shape: 'rect' | 'ellipse' | 'icon'
            x: number
            y: number
            width: number
            height: number
            rotation: number
            z: number
            label: string | null
            color: string | null
            cornerRadius: number | null
          }>)
          if (res.status === 'ok') await refresh()
          return res
        }}
        onElementDelete={async (elementId) => {
          const res = await deleteElementForSite(siteId, elementId)
          if (res.status === 'ok') await refresh()
          return res
        }}
      />
      </div>
    </div>
  )
}
