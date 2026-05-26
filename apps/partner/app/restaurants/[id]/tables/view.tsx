'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  TableLayoutEditor,
  type TableLayoutEditorLabels,
  CombinationsEditor,
  type CombinationsEditorLabels,
} from '@repo/table-reservations-ui'
import type {
  LayoutElementRecord,
  TableInput,
  TableRecord,
  TableCombinationRecord,
} from '@repo/table-reservations-core'
import { RESTAURANT_ELEMENT_PRESETS } from '@repo/table-reservations-ui'
import {
  CanvasDimensionsHeader,
  type SaveStatus,
} from '@repo/schematic-editor'
import { getRestaurantLayout, getRestaurantCombinations, type RestaurantLayout } from '../queries'
import {
  createTableForRestaurant,
  updateTableForRestaurant,
  deleteTableForRestaurant,
  duplicateTableForRestaurant,
  createElementForRestaurant,
  updateElementForRestaurant,
  deleteElementForRestaurant,
  saveRestaurantCanvasDimensions,
} from './actions'
import {
  createRestaurantCombination,
  updateRestaurantCombination,
  deleteRestaurantCombination,
} from '../actions'
import { RestaurantSubNav } from '../RestaurantSubNav'
import { RestaurantHeader } from '../RestaurantHeader'

export default function TablesView({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('Restaurant')

  const [layout, setLayout] = useState<RestaurantLayout | null>(null)
  const [combinations, setCombinations] = useState<TableCombinationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  const refreshLayout = useCallback(async () => {
    const l = await getRestaurantLayout(restaurantId)
    setLayout(l)
  }, [restaurantId])

  const refreshCombinations = useCallback(async () => {
    const c = await getRestaurantCombinations(restaurantId)
    setCombinations(c ?? [])
  }, [restaurantId])

  const refresh = useCallback(async () => {
    await Promise.all([refreshLayout(), refreshCombinations()])
  }, [refreshLayout, refreshCombinations])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getRestaurantLayout(restaurantId),
      getRestaurantCombinations(restaurantId),
    ]).then(([l, c]) => {
      setLayout(l)
      setCombinations(c ?? [])
      setLoading(false)
    })
  }, [restaurantId])

  if (loading || !layout) {
    return (
      <div className="pt-2">
        <RestaurantSubNav restaurantId={restaurantId} active="tables" />
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
        terrace: t('elementTerrace'),
        bar: t('elementBar'),
        lounge: t('elementLounge'),
        private: t('elementPrivate'),
        kitchen: t('elementKitchen'),
        entrance: t('elementEntrance'),
        'bar-counter': t('elementBarCounter'),
        'host-stand': t('elementHostStand'),
        restroom: t('elementRestroom'),
        wall: t('elementWall'),
        pillar: t('elementPillar'),
        plant: t('elementPlant'),
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
      combinable: t('tableFieldCombinable'),
      featuresHeading: t('tableFeaturesHeading'),
      featureAccessible: t('tableFeatureAccessible'),
      featureWindow: t('tableFeatureWindow'),
      featureOutdoor: t('tableFeatureOutdoor'),
      featureHighTop: t('tableFeatureHighTop'),
      featureCommunal: t('tableFeatureCommunal'),
      featureQuiet: t('tableFeatureQuiet'),
      depositHeading: t('tableDepositHeading'),
      depositInherit: t('tableDepositInherit'),
      depositRequire: t('tableDepositRequire'),
      depositExempt: t('tableDepositExempt'),
      depositPerGuest: t('tableDepositPerGuest'),
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
    addTable: t('addTable'),
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
        terrace: t('elementTerrace'),
        bar: t('elementBar'),
        lounge: t('elementLounge'),
        private: t('elementPrivate'),
        kitchen: t('elementKitchen'),
        entrance: t('elementEntrance'),
        'bar-counter': t('elementBarCounter'),
        'host-stand': t('elementHostStand'),
        restroom: t('elementRestroom'),
        wall: t('elementWall'),
        pillar: t('elementPillar'),
        plant: t('elementPlant'),
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

  const combinationsLabels: CombinationsEditorLabels = {
    heading: t('combinationsHeading'),
    addCombination: t('combinationsAdd'),
    emptyNoCombinations: t('combinationsEmpty'),
    emptyNoTables: t('combinationsNoTables'),
    name: t('combinationsName'),
    namePlaceholder: t('combinationsNamePlaceholder'),
    capacity: t('combinationsCapacity'),
    tablesHeading: t('combinationsTables'),
    tablesNoneSelected: t('combinationsTablesNoneSelected'),
    tableLabel: t('combinationsTableLabel'),
    save: t('combinationsSave'),
    saving: t('saving'),
    cancel: t('cancel'),
    delete: t('combinationsDelete'),
    edit: t('combinationsEdit'),
    combinationCapacitySuggestion: t('combinationsCapacitySuggestion'),
    errorMinTables: t('combinationsErrorMinTables'),
  }

  // Only pass combinable tables to the editor — server also validates this.
  const combinableTables = (layout.tables as TableRecord[])
    .filter((t) => t.combinable)
    .map((t) => ({ id: t.id, number: t.number, label: t.label ?? null, capacity: t.capacity }))

  return (
    <div className="pt-2">
      <RestaurantSubNav restaurantId={restaurantId} active="tables" />
      <div className="p-4 space-y-4">
        <RestaurantHeader
          restaurantId={restaurantId}
          saveStatus={saveStatus}
          saveError={saveErrors.length > 0 ? saveErrors.join(', ') : undefined}
        />
        <TableLayoutEditor
          worldWidth={layout.layoutWidth}
          worldHeight={layout.layoutHeight}
          tables={layout.tables as TableRecord[]}
          elements={layout.elements as LayoutElementRecord[]}
          labels={labels}
          onSaveStatusChange={trackSave}
          toolbarRight={
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
                const res = await saveRestaurantCanvasDimensions(restaurantId, w, h)
                if (res.status === 'ok') {
                  await refreshLayout()
                  trackSave('saved')
                } else {
                  trackSave('error', res.errors)
                }
              }}
            />
          }
          onTablePatch={async (tableId, patch) => {
            const res = await updateTableForRestaurant(restaurantId, tableId, patch as Partial<TableInput>)
            if (res.status === 'ok') await refresh()
            return res
          }}
          onTableDelete={async (tableId) => {
            const res = await deleteTableForRestaurant(restaurantId, tableId)
            if (res.status === 'ok') await refresh()
            return res
          }}
          onTableDuplicate={async (tableId) => {
            const res = await duplicateTableForRestaurant(restaurantId, tableId)
            if (res.status === 'ok') await refreshLayout()
            return res
          }}
          onTableCreate={async (at) => {
            const res = await createTableForRestaurant(restaurantId, at)
            if (res.status === 'ok') await refreshLayout()
            return res
          }}
          onElementCreate={async (at, type) => {
            const preset = RESTAURANT_ELEMENT_PRESETS[type]
            if (!preset) {
              return { status: 'error' as const, errors: ['Unknown element type'] }
            }
            const res = await createElementForRestaurant(restaurantId, {
              type: preset.type,
              shape: preset.shape,
              x: at.x - preset.width / 2,
              y: at.y - preset.height / 2,
              width: preset.width,
              height: preset.height,
            })
            if (res.status === 'ok') await refreshLayout()
            return res
          }}
          onElementPatch={async (elementId, patch) => {
            const res = await updateElementForRestaurant(restaurantId, elementId, patch as Partial<{
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
            if (res.status === 'ok') await refreshLayout()
            return res
          }}
          onElementDelete={async (elementId) => {
            const res = await deleteElementForRestaurant(restaurantId, elementId)
            if (res.status === 'ok') await refreshLayout()
            return res
          }}
        />

        <CombinationsEditor
          combinations={combinations}
          combinableTables={combinableTables}
          labels={combinationsLabels}
          onCreate={async (input) => {
            const res = await createRestaurantCombination(restaurantId, input)
            if (res.status === 'ok') await refreshCombinations()
            return res
          }}
          onUpdate={async (id, patch) => {
            const res = await updateRestaurantCombination(restaurantId, id, patch)
            if (res.status === 'ok') await refreshCombinations()
            return res
          }}
          onDelete={async (id) => {
            const res = await deleteRestaurantCombination(restaurantId, id)
            if (res.status === 'ok') await refreshCombinations()
            return res
          }}
        />
      </div>
    </div>
  )
}
