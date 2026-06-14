'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSite } from '@/app/sites/site-context'
import type { InventoryItem, LayoutElementProps } from '@/types/shared'
import { getSite } from '../queries'
import { saveLayoutDimensions } from '../site-actions'
import {
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemSchematicLocation,
  pairInventoryItems,
} from '../inventory-actions'
import { useSunbedEditing } from '../inventory/useSunbedEditing'
import {
  syncChairsWithLayout,
  getItemGroup,
  moveParcel,
  moveItems,
  rotateSelection,
  adjustItemSpacing,
  assignItemsToGroup,
  removeItemsFromGroup,
} from '../inventory/actions'
import {
  createLayoutElement,
  updateLayoutElement,
  deleteLayoutElement,
} from './actions'
import { ChairConfig, getParcelColor } from '../inventory/chair-util'
import InventoryForm from '../inventory/InventoryForm'
import ParcelForm from '../inventory/ParcelForm'
import InventoryToolbar from '../inventory/InventoryToolbar'
import ParcelList from '../inventory/ParcelList'
import { ELEMENT_PRESETS } from './palette'
import SchematicCanvas from './SchematicCanvas'
import ElementPalette from './ElementPalette'
import ElementForm from './ElementForm'

type EditorMode = 'none' | 'create-chair' | 'edit-chair' | 'create-parcel' | 'edit-parcel'

// Default labels applied on drop, per object type. Surfaces stay unlabeled.
const OBJECT_DEFAULT_LABEL_KEY: Record<string, string> = {
  pool: 'defaultLabelPool',
  bar: 'defaultLabelBar',
  reception: 'defaultLabelReception',
  shower: 'defaultLabelShower',
  restroom: 'defaultLabelRestroom',
}

export default function SchematicView() {
  const t = useTranslations('SiteSchematic')
  const { site, setSite } = useSite()
  const siteId = site.id || ''

  const inventory: InventoryItem[] = site.inventoryItems || []
  const elements: LayoutElementProps[] = site.layoutElements || []
  const worldWidth = site.layoutWidth ?? 50
  const worldHeight = site.layoutHeight ?? 35
  const [widthInput, setWidthInput] = useState(String(worldWidth))
  const [heightInput, setHeightInput] = useState(String(worldHeight))
  useEffect(() => {
    setWidthInput(String(site.layoutWidth ?? 50))
    setHeightInput(String(site.layoutHeight ?? 35))
  }, [site.layoutWidth, site.layoutHeight])
  const dimsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDims = (w: string, h: string) => {
    if (dimsDebounceRef.current) clearTimeout(dimsDebounceRef.current)
    dimsDebounceRef.current = setTimeout(async () => {
      const wn = Number(w)
      const hn = Number(h)
      if (!Number.isFinite(wn) || !Number.isFinite(hn)) return
      await saveLayoutDimensions(siteId, wn, hn)
      await refresh()
    }, 600)
  }

  const [editorMode, setEditorMode] = useState<EditorMode>('none')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [itemPanelOpen, setItemPanelOpen] = useState(false)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [propertiesOpenId, setPropertiesOpenId] = useState<string | null>(null)
  const [editGroup, setEditGroup] = useState<number | null>(null)
  const [pairingForId, setPairingForId] = useState<string | null>(null)

  const [parcelConfig, setParcelConfig] = useState<ChairConfig>({
    rows: 6,
    seatsPerRow: 10,
    horizontalGap: 1,
    verticalGap: 1.5,
    rotation: 0,
    group: 1,
    category: 'PRICE1',
    price: site.price || 9,
    pairSeats: true,
    intraPairGap: 0.4,
    baseLat: worldHeight / 2,
    baseLng: worldWidth / 2,
  })

  const propertiesElement = elements.find((e) => e.id === propertiesOpenId) || null
  const selectedItem = inventory.find((i) => i.id === selectedItemId) || null
  const isParcelEditorActive = editorMode === 'create-parcel' || editorMode === 'edit-parcel'

  // Summary
  const totalSunbeds = inventory.length
  const parcelGroups = new Set(inventory.filter(i => i.group && i.group > 0).map(i => i.group))
  const totalParcels = parcelGroups.size

  // Selection grouping
  const selectedParcelGroupNumber = useMemo(() => {
    if (selectedItemIds.length < 2) return null
    const items = inventory.filter(i => selectedItemIds.includes(i.id))
    if (items.length === 0) return null
    const groups = new Set(items.map(i => i.group))
    if (groups.size !== 1) return null
    return items[0]!.group || null
  }, [selectedItemIds, inventory])

  const selectedParcelTotal = useMemo(() => {
    if (!selectedParcelGroupNumber) return 0
    return inventory.filter(i => i.group === selectedParcelGroupNumber).length
  }, [selectedParcelGroupNumber, inventory])

  const isCompleteParcelSelected = useMemo(() => {
    if (!selectedParcelGroupNumber) return false
    const totalInGroup = inventory.filter(i => i.group === selectedParcelGroupNumber).length
    const selectedInGroup = inventory.filter(i =>
      i.group === selectedParcelGroupNumber && selectedItemIds.includes(i.id)
    ).length
    return selectedInGroup === totalInGroup
  }, [selectedParcelGroupNumber, selectedItemIds, inventory])

  const allParcelNumbers = useMemo(() => {
    const groups = new Set(inventory.filter(i => i.group && i.group > 0).map(i => i.group))
    return Array.from(groups).sort((a, b) => a - b)
  }, [inventory])

  const [selectedParcelConfig, setSelectedParcelConfig] = useState<ChairConfig | null>(null)

  useEffect(() => {
    if (!selectedParcelGroupNumber) {
      setSelectedParcelConfig(null)
      return
    }
    const groupItems = inventory.filter(i => i.group === selectedParcelGroupNumber)
    const firstWithGroup = groupItems.find(i => i.itemGroupId)
    if (firstWithGroup?.itemGroupId) {
      getItemGroup(firstWithGroup.itemGroupId).then(ig => {
        if (!ig) return
        setSelectedParcelConfig({
          itemGroupId: ig.id,
          rows: Math.ceil(groupItems.length / ig.seatsPerRow),
          seatsPerRow: ig.seatsPerRow,
          horizontalGap: ig.horizontalGap,
          verticalGap: ig.verticalGap,
          rotation: ig.rotation,
          group: ig.number,
          category: ig.category || undefined,
          price: ig.price || undefined,
          pairSeats: ig.pairGap > 0,
          intraPairGap: ig.pairGap,
          baseLat: ig.schematicY ?? 0,
          baseLng: ig.schematicX ?? 0,
        })
      })
    } else {
      const xs = groupItems.map(i => i.schematicX ?? 0)
      const ys = groupItems.map(i => i.schematicY ?? 0)
      const avgX = xs.reduce((s, v) => s + v, 0) / xs.length
      const avgY = ys.reduce((s, v) => s + v, 0) / ys.length
      setSelectedParcelConfig({
        rows: Math.ceil(groupItems.length / (parcelConfig.seatsPerRow || 4)),
        seatsPerRow: parcelConfig.seatsPerRow || 4,
        horizontalGap: parcelConfig.horizontalGap,
        verticalGap: parcelConfig.verticalGap,
        rotation: groupItems[0]?.rotation || 0,
        group: selectedParcelGroupNumber,
        pairSeats: true,
        intraPairGap: parcelConfig.intraPairGap,
        baseLat: avgY,
        baseLng: avgX,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedParcelGroupNumber])

  async function refresh() {
    const updated = await getSite(siteId)
    if (updated) setSite(updated)
  }

  const sunbedEditing = useSunbedEditing(siteId, refresh)

  // ─── Escape key ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in a form field
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.key === 'Escape') {
        setSelectedItemIds([])
        setSelectedItemId(null)
        setSelectedElementId(null)
        setPropertiesOpenId(null)
        setEditorMode('none')
        setEditGroup(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId) {
          e.preventDefault()
          deleteLayoutElement(selectedElementId).then(() => {
            setSelectedElementId(null)
            setPropertiesOpenId(null)
            refresh()
          })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedElementId])

  // ─── Parcel handlers ───────────────────────────────────────────────────
  const handleParcelReorder = async () => {
    if (!selectedParcelConfig || !selectedParcelGroupNumber) return
    const groupItems = inventory.filter(i => i.group === selectedParcelGroupNumber)
    const firstWithGroup = groupItems.find(i => i.itemGroupId)
    let baseLat = selectedParcelConfig.baseLat
    let baseLng = selectedParcelConfig.baseLng
    if (firstWithGroup?.itemGroupId) {
      const ig = await getItemGroup(firstWithGroup.itemGroupId)
      if (ig) {
        baseLat = ig.schematicY ?? baseLat
        baseLng = ig.schematicX ?? baseLng
      }
    }
    await syncChairsWithLayout(siteId, { ...selectedParcelConfig, baseLat, baseLng }, 'rearrange')
    const updated = await getSite(siteId)
    if (updated) {
      setSite(updated)
      const updatedGroupItems = (updated.inventoryItems || []).filter(
        (i: InventoryItem) => i.group === selectedParcelGroupNumber,
      )
      setSelectedItemIds(updatedGroupItems.map((i: InventoryItem) => i.id))
    }
  }

  const handleEditParcelFull = () => {
    if (!selectedParcelConfig || !selectedParcelGroupNumber) return
    setParcelConfig(selectedParcelConfig)
    setEditGroup(selectedParcelGroupNumber)
    setEditorMode('edit-parcel')
    setSelectedItemId(null)
    setSelectedItemIds([])
  }

  // ─── Selection operations ──────────────────────────────────────────────
  const handleRotateSelected = async (delta: number) => {
    if (selectedItemIds.length === 0) return

    // Complete parcel: regenerate grid at new rotation (mirrors ParcelForm "Apply").
    if (isCompleteParcelSelected && selectedParcelGroupNumber) {
      const groupItems = inventory.filter(i => i.group === selectedParcelGroupNumber)
      const firstWithGroup = groupItems.find(i => i.itemGroupId)
      if (firstWithGroup?.itemGroupId) {
        const ig = await getItemGroup(firstWithGroup.itemGroupId)
        if (ig) {
          const newConfig: ChairConfig = {
            rows: Math.ceil(groupItems.length / ig.seatsPerRow),
            seatsPerRow: ig.seatsPerRow,
            horizontalGap: ig.horizontalGap,
            verticalGap: ig.verticalGap,
            rotation: ig.rotation + delta,
            group: ig.number,
            category: ig.category || undefined,
            price: ig.price || undefined,
            pairSeats: ig.pairGap > 0,
            intraPairGap: ig.pairGap,
            baseLat: ig.schematicY ?? 0,
            baseLng: ig.schematicX ?? 0,
          }
          await syncChairsWithLayout(siteId, newConfig, 'rearrange')
          await refresh()
          return
        }
      }
    }

    await rotateSelection(siteId, selectedItemIds, delta)
    await refresh()
  }

  const handleAdjustSpacing = async (axis: 'horizontal' | 'vertical', factor: number) => {
    if (selectedItemIds.length < 2) return
    await adjustItemSpacing(siteId, selectedItemIds, axis, factor)
    await refresh()
  }

  const handleAssignToParcel = async (group: number) => {
    if (selectedItemIds.length === 0) return
    await assignItemsToGroup(siteId, selectedItemIds, group)
    await refresh()
  }

  const handleRemoveFromParcel = async () => {
    if (selectedItemIds.length === 0) return
    await removeItemsFromGroup(siteId, selectedItemIds)
    await refresh()
  }

  const handleSelectEntireParcel = (group: number) => {
    const parcelItems = inventory.filter(i => i.group === group)
    setSelectedItemIds(parcelItems.map(i => i.id))
  }

  const handleRestoreParcelOrder = async (group: number) => {
    const groupItems = inventory.filter(i => i.group === group)
    if (groupItems.length === 0) return
    const firstWithGroup = groupItems.find(i => i.itemGroupId)
    let config: ChairConfig
    if (firstWithGroup?.itemGroupId) {
      const ig = await getItemGroup(firstWithGroup.itemGroupId)
      if (!ig) return
      config = {
        itemGroupId: ig.id,
        rows: Math.ceil(groupItems.length / ig.seatsPerRow),
        seatsPerRow: ig.seatsPerRow,
        horizontalGap: ig.horizontalGap,
        verticalGap: ig.verticalGap,
        rotation: ig.rotation,
        group: ig.number,
        category: ig.category || undefined,
        price: ig.price || undefined,
        pairSeats: ig.pairGap > 0,
        intraPairGap: ig.pairGap,
        baseLat: ig.schematicY ?? 0,
        baseLng: ig.schematicX ?? 0,
      }
    } else {
      const xs = groupItems.map(i => i.schematicX ?? 0)
      const ys = groupItems.map(i => i.schematicY ?? 0)
      const avgX = xs.reduce((s, v) => s + v, 0) / xs.length
      const avgY = ys.reduce((s, v) => s + v, 0) / ys.length
      config = {
        rows: Math.ceil(groupItems.length / (parcelConfig.seatsPerRow || 4)),
        seatsPerRow: parcelConfig.seatsPerRow || 4,
        horizontalGap: parcelConfig.horizontalGap,
        verticalGap: parcelConfig.verticalGap,
        rotation: groupItems[0]?.rotation || 0,
        group,
        pairSeats: true,
        intraPairGap: parcelConfig.intraPairGap,
        baseLat: avgY,
        baseLng: avgX,
      }
    }
    await syncChairsWithLayout(siteId, config, 'rearrange')
    const updated = await getSite(siteId)
    if (updated) {
      setSite(updated)
      const updatedGroupItems = (updated.inventoryItems || []).filter(
        (i: InventoryItem) => i.group === group,
      )
      setSelectedItemIds(updatedGroupItems.map((i: InventoryItem) => i.id))
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return
    await Promise.all(selectedItemIds.map(id => deleteInventoryItem(id)))
    setSelectedItemIds([])
    await refresh()
  }

  // ─── Single-item toolbar actions ──────────────────────────────────────────

  async function handleRotateSingleItem(delta: number) {
    if (!selectedItemId || !selectedItem) return
    // Group-first: collect other members of the same SunbedGroup from in-memory inventory.
    const partnerIds: string[] = selectedItem.sunbedGroupId
      ? inventory
          .filter((i) => i.sunbedGroupId === selectedItem.sunbedGroupId && i.id !== selectedItemId)
          .map((i) => i.id)
      : []
    // pairId fallback: for items not yet in a group, use the old pairId chain.
    if (partnerIds.length === 0) {
      const legacyPartnerId =
        selectedItem.pairId ??
        selectedItem.pair?.id ??
        selectedItem.pairedBy?.id ??
        null
      if (legacyPartnerId) partnerIds.push(legacyPartnerId)
    }
    await sunbedEditing.rotateSingle(selectedItemId, selectedItem.rotation ?? 0, delta, partnerIds)
  }

  async function handleDeleteSingleItem() {
    if (!selectedItemId) return
    setSelectedItemId(null)
    setItemPanelOpen(false)
    setEditorMode('none')
    await sunbedEditing.deleteSingle(selectedItemId)
  }

  async function handleDepairItem() {
    if (!selectedItemId) return
    await sunbedEditing.depair(selectedItemId)
  }

  // ─── Canvas interactions ───────────────────────────────────────────────

  async function handleElementDrop(type: string, x: number, y: number) {
    const preset = ELEMENT_PRESETS[type]
    if (!preset) return
    const cx = x - preset.width / 2
    const cy = y - preset.height / 2
    const labelKey = OBJECT_DEFAULT_LABEL_KEY[type]
    await createLayoutElement(siteId, {
      type: preset.type,
      shape: preset.shape,
      x: cx,
      y: cy,
      width: preset.width,
      height: preset.height,
      label: labelKey ? t(labelKey) : null,
    })
    await refresh()
  }

  async function handleBackgroundClick(x: number, y: number) {
    if (pairingForId) { setPairingForId(null); return }
    if (editorMode === 'create-parcel') {
      const newGroup = Math.max(0, ...inventory.map(i => i.group || 0)) + 1
      const newConfig: ChairConfig = {
        ...parcelConfig,
        group: newGroup,
        baseLat: y,
        baseLng: x,
      }
      setParcelConfig(newConfig)
      await syncChairsWithLayout(siteId, newConfig, 'create')
      const updated = await getSite(siteId)
      if (updated) {
        setSite(updated)
        const newItems = (updated.inventoryItems || []).filter((i: InventoryItem) => i.group === newGroup)
        setSelectedItemIds(newItems.map((i: InventoryItem) => i.id))
      }
      setEditorMode('none')
      return
    }

    if (editorMode === 'edit-parcel') {
      const deltaY = y - parcelConfig.baseLat
      const deltaX = x - parcelConfig.baseLng
      setParcelConfig({ ...parcelConfig, baseLat: y, baseLng: x })
      await moveParcel(siteId, parcelConfig.group, deltaY, deltaX)
      await refresh()
      return
    }

    if (editorMode === 'create-chair') {
      const result = await createInventoryItem({ siteId })
      if (result.status === 'ok' && result.item) {
        await saveInventoryItemSchematicLocation(result.item.id, x, y)
        const updated = await getSite(siteId)
        if (updated) setSite(updated)
        setSelectedItemId(result.item.id)
        setEditorMode('edit-chair')
      }
      return
    }

    // Default: clear selection
    setSelectedItemIds([])
    setSelectedItemId(null)
    setSelectedElementId(null)
    setPropertiesOpenId(null)
  }

  async function handleItemClick(id: string, mods: { metaKey: boolean; ctrlKey: boolean }) {
    // Pairing mode: second click pairs the two items
    if (pairingForId && id !== pairingForId) {
      await pairInventoryItems(pairingForId, id)
      setPairingForId(null)
      await refresh()
      return
    }
    setPairingForId(null)

    if (mods.metaKey || mods.ctrlKey) {
      setSelectedItemIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
      )
      setSelectedItemId(null)
      if (editorMode === 'edit-chair') setEditorMode('none')
      return
    }
    const item = inventory.find(i => i.id === id)
    if (!item) return
    const toggling = selectedItemId === id
    setSelectedItemId(toggling ? null : id)
    if (toggling) { setItemPanelOpen(false); setEditorMode('none') }
    else setEditorMode('edit-chair')
    setSelectedItemIds([])
    setSelectedElementId(null)
    setPropertiesOpenId(null)
  }

  function handleItemDoubleClick(id: string) {
    setSelectedItemId(id)
    setEditorMode('edit-chair')
    setItemPanelOpen(true)
    setSelectedItemIds([])
    setSelectedElementId(null)
    setPropertiesOpenId(null)
  }

  async function handleItemDragEnd(id: string, x: number, y: number) {
    const dragged = inventory.find((i) => i.id === id)
    if (!dragged) return
    const dx = x - (dragged.schematicX ?? 0)
    const dy = y - (dragged.schematicY ?? 0)

    // Multi-selection drag (e.g. whole parcel selected): move every selected
    // bed by the same delta. Server-side moveItems also updates the ItemGroup
    // anchor when all group members are included.
    if (selectedItemIds.length > 1 && selectedItemIds.includes(id)) {
      await moveItems(siteId, selectedItemIds, dy, dx)
      await refresh()
      return
    }

    // Group-drag: all other group members follow.
    // Group-first: resolve via sunbedGroupId; fall back to pairId for legacy items.
    let groupPartners: InventoryItem[] = dragged.sunbedGroupId
      ? inventory.filter((i) => i.sunbedGroupId === dragged.sunbedGroupId && i.id !== id)
      : []
    if (groupPartners.length === 0) {
      const legacyPartnerId =
        dragged.pairId ?? dragged.pair?.id ?? dragged.pairedBy?.id ?? null
      const legacyPartner = legacyPartnerId
        ? inventory.find((i) => i.id === legacyPartnerId) ?? null
        : null
      if (legacyPartner) groupPartners = [legacyPartner]
    }
    await Promise.all([
      saveInventoryItemSchematicLocation(id, x, y),
      ...groupPartners.map((partner) =>
        saveInventoryItemSchematicLocation(
          partner.id,
          (partner.schematicX ?? 0) + dx,
          (partner.schematicY ?? 0) + dy,
        ),
      ),
    ])
    await refresh()
  }

  function handleElementClick(id: string) {
    setSelectedElementId(id)
    setSelectedItemIds([])
    setSelectedItemId(null)
    if (propertiesOpenId && propertiesOpenId !== id) setPropertiesOpenId(null)
  }

  function handleElementDoubleClick(id: string) {
    setSelectedElementId(id)
    setSelectedItemIds([])
    setSelectedItemId(null)
    setPropertiesOpenId(id)
  }

  async function handleElementDragEnd(id: string, x: number, y: number) {
    await updateLayoutElement(id, { x, y })
    await refresh()
  }

  async function handleElementResizeEnd(id: string, x: number, y: number, width: number, height: number) {
    await updateLayoutElement(id, { x, y, width, height })
    await refresh()
  }

  async function handleElementPatch(patch: Partial<LayoutElementProps>) {
    if (!propertiesElement) return
    await updateLayoutElement(propertiesElement.id, patch as any)
    await refresh()
  }

  async function handleElementDelete() {
    if (!propertiesElement) return
    await deleteLayoutElement(propertiesElement.id)
    setSelectedElementId(prev => (prev === propertiesElement.id ? null : prev))
    setPropertiesOpenId(null)
    await refresh()
  }

  // ─── Side panel visibility ─────────────────────────────────────────────
  const showItemPanel = !!selectedItem && editorMode === 'edit-chair' && itemPanelOpen
  const showParcelPanel = isParcelEditorActive
  const showElementPanel = !!propertiesElement
  const showRightPanel = showItemPanel || showParcelPanel || showElementPanel

  return (
    <div className="flex flex-col -mt-2">
      {/* Summary strip */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
        <span>{t('totalSunbedsLabel', { count: totalSunbeds })}</span>
        <span className="text-gray-300">·</span>
        <span>{t('parcelsLabel', { count: totalParcels })}</span>
        <span className="text-gray-300">·</span>
        <span>{t('totalElements', { count: elements.length })}</span>
        <span className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1">
            <span>{t('layoutWidth')}</span>
            <input
              type="number"
              min={5}
              max={500}
              value={widthInput}
              onChange={(e) => {
                setWidthInput(e.target.value)
                saveDims(e.target.value, heightInput)
              }}
              className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700"
            />
            <span>m</span>
          </label>
          <label className="flex items-center gap-1">
            <span>{t('layoutHeight')}</span>
            <input
              type="number"
              min={5}
              max={500}
              value={heightInput}
              onChange={(e) => {
                setHeightInput(e.target.value)
                saveDims(widthInput, e.target.value)
              }}
              className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700"
            />
            <span>m</span>
          </label>
        </span>
      </div>

      {/* Parcel list */}
      <ParcelList
        inventory={inventory}
        allParcelNumbers={allParcelNumbers}
        selectedItemIds={selectedItemIds}
        onSelectParcel={handleSelectEntireParcel}
        onRestoreOrder={handleRestoreParcelOrder}
      />

      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-gray-100 bg-white">
        <InventoryToolbar
          creating={editorMode === 'create-chair'}
          creatingParcel={editorMode === 'create-parcel'}
          selectedItemCount={selectedItemIds.length}
          selectedParcelGroup={selectedParcelGroupNumber}
          selectedParcelTotal={selectedParcelTotal}
          isCompleteParcelSelected={isCompleteParcelSelected}
          allParcelNumbers={allParcelNumbers}
          onClearSelection={() => {
            setSelectedItemIds([])
            setSelectedItemId(null)
            setItemPanelOpen(false)
            setPairingForId(null)
            if (editorMode === 'edit-chair') setEditorMode('none')
          }}
          onDeleteSelected={handleDeleteSelected}
          onRotateSelected={handleRotateSelected}
          onAdjustSpacing={handleAdjustSpacing}
          onAssignToParcel={handleAssignToParcel}
          onRemoveFromParcel={handleRemoveFromParcel}
          onSelectEntireParcel={handleSelectEntireParcel}
          onParcelReorder={handleParcelReorder}
          onEditParcelFull={handleEditParcelFull}
          selectedSingleItemId={
            editorMode === 'edit-chair' && selectedItem ? selectedItem.id : null
          }
          selectedSingleItemNumber={selectedItem?.number ?? null}
          selectedSingleItemLabel={selectedItem?.seatLabel ?? null}
          selectedSingleItemParcelColor={
            selectedItem?.group ? getParcelColor(selectedItem.group) ?? null : null
          }
          selectedSingleItemHasPair={!!selectedItem?.sunbedGroupId}
          pairingMode={!!pairingForId}
          isEditPanelOpen={itemPanelOpen}
          onRotateSingle={handleRotateSingleItem}
          onTogglePairing={() =>
            setPairingForId(pairingForId ? null : selectedItemId)
          }
          onDepairSingle={handleDepairItem}
          onEditSingle={() => setItemPanelOpen((v) => !v)}
          onDeleteSingle={handleDeleteSingleItem}
          onStartCreate={() => {
            setEditorMode('create-chair')
            setSelectedItemId(null)
            setSelectedItemIds([])
          }}
          onStartParcel={() => {
            setEditorMode('create-parcel')
            setSelectedItemId(null)
            setSelectedItemIds([])
          }}
          onCancel={() => {
            setEditorMode('none')
            setSelectedItemId(null)
            setSelectedItemIds([])
          }}
        />
      </div>

      <div className="flex relative" style={{ height: '600px' }}>
        <ElementPalette />

        <div className="flex-1 relative bg-gray-100">
          {selectedElementId ? (() => {
            const selected = elements.find((e) => e.id === selectedElementId)
            if (!selected) return null
            const bump = async (delta: number) => {
              await updateLayoutElement(selected.id, { z: (selected.z ?? 0) + delta })
              await refresh()
            }
            return (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
                <div className="flex gap-1 bg-white/95 backdrop-blur border border-gray-200 rounded-md shadow-sm p-1">
                  <button
                    type="button"
                    onClick={() => bump(1)}
                    title={t('bringForward')}
                    className="h-7 px-2 flex items-center text-xs text-gray-700 rounded hover:bg-gray-100 whitespace-nowrap"
                  >
                    ↑ {t('bringForward')}
                  </button>
                  <button
                    type="button"
                    onClick={() => bump(-1)}
                    title={t('sendBackward')}
                    className="h-7 px-2 flex items-center text-xs text-gray-700 rounded hover:bg-gray-100 whitespace-nowrap"
                  >
                    ↓ {t('sendBackward')}
                  </button>
                </div>
                <div className="flex gap-1 bg-white/95 backdrop-blur border border-gray-200 rounded-md shadow-sm p-1">
                  <button
                    type="button"
                    onClick={() => setPropertiesOpenId(selected.id)}
                    title={t('editElement')}
                    className="w-7 h-7 flex items-center justify-center text-sm text-gray-700 rounded hover:bg-gray-100"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteLayoutElement(selected.id)
                      setSelectedElementId(null)
                      setPropertiesOpenId(null)
                      await refresh()
                    }}
                    title={t('deleteElement')}
                    className="w-7 h-7 flex items-center justify-center text-sm text-red-600 rounded hover:bg-red-50"
                  >
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedElementId(null)
                    setPropertiesOpenId(null)
                  }}
                  className="text-[11px] text-gray-500 hover:text-gray-700 underline px-1"
                >
                  {t('deselect')}
                </button>
              </div>
            )
          })() : null}
          <SchematicCanvas
            worldWidth={worldWidth}
            worldHeight={worldHeight}
            bgImageUrl={site.bgImageUrl}
            elements={elements}
            items={inventory}
            selectedItemIds={selectedItemIds}
            editingItemId={selectedItemId}
            selectedElementId={selectedElementId}
            highlightedGroup={editGroup}
            placementActive={
              editorMode === 'create-chair' ||
              editorMode === 'create-parcel' ||
              editorMode === 'edit-parcel'
            }
            onItemClick={handleItemClick}
            onItemDragEnd={handleItemDragEnd}
            onItemDoubleClick={handleItemDoubleClick}
            onElementClick={handleElementClick}
            onElementDoubleClick={handleElementDoubleClick}
            onElementDragEnd={handleElementDragEnd}
            onElementResizeEnd={handleElementResizeEnd}
            onBackgroundClick={handleBackgroundClick}
            onElementDrop={handleElementDrop}
            onItemsRectSelect={(ids, mods) => {
              setSelectedItemIds((prev) =>
                mods.metaKey || mods.ctrlKey
                  ? Array.from(new Set([...prev, ...ids]))
                  : ids,
              )
              setSelectedItemId(null)
              setSelectedElementId(null)
              setItemPanelOpen(false)
              if (editorMode === 'edit-chair') setEditorMode('none')
            }}
          />
        </div>

        {showRightPanel ? (
          <div className="absolute right-0 top-0 bottom-0 w-80 border-l border-gray-200 bg-white overflow-y-auto shadow-lg z-10">
            {showItemPanel && selectedItem ? (
              <InventoryForm
                selectedItem={selectedItem}
                onDelete={() => {
                  setSelectedItemId(null)
                  setEditorMode('none')
                  refresh()
                }}
                onEditGroup={async (item) => {
                  const groupNumber = item.group || 1
                  const allGroupItems = inventory.filter(i => i.group === groupNumber)
                  if (item.itemGroupId) {
                    const ig = await getItemGroup(item.itemGroupId)
                    if (ig) {
                      const config: ChairConfig = {
                        itemGroupId: ig.id,
                        rows: Math.ceil(allGroupItems.length / ig.seatsPerRow),
                        seatsPerRow: ig.seatsPerRow,
                        horizontalGap: ig.horizontalGap,
                        verticalGap: ig.verticalGap,
                        rotation: ig.rotation,
                        group: ig.number,
                        category: ig.category || undefined,
                        price: ig.price || undefined,
                        pairSeats: ig.pairGap > 0,
                        intraPairGap: ig.pairGap,
                        baseLat: ig.schematicY ?? 0,
                        baseLng: ig.schematicX ?? 0,
                      }
                      setParcelConfig(config)
                      setEditGroup(ig.number)
                      setEditorMode('edit-parcel')
                      setSelectedItemId(null)
                      return
                    }
                  }
                  const xs = allGroupItems.map(i => i.schematicX ?? 0)
                  const ys = allGroupItems.map(i => i.schematicY ?? 0)
                  const avgX = xs.reduce((s, v) => s + v, 0) / Math.max(xs.length, 1)
                  const avgY = ys.reduce((s, v) => s + v, 0) / Math.max(ys.length, 1)
                  const seatsPerRow = parcelConfig.seatsPerRow || 4
                  setParcelConfig(prev => ({
                    ...prev,
                    group: groupNumber,
                    rows: Math.ceil(allGroupItems.length / seatsPerRow),
                    seatsPerRow,
                    baseLat: avgY,
                    baseLng: avgX,
                    rotation: allGroupItems[0]?.rotation || 0,
                  }))
                  setEditGroup(groupNumber)
                  setEditorMode('edit-parcel')
                  setSelectedItemId(null)
                }}
                onClose={() => setItemPanelOpen(false)}
              />
            ) : null}
            {showParcelPanel ? (
              <ParcelForm
                mode={editorMode === 'edit-parcel' ? 'edit' : 'create'}
                siteId={siteId}
                editGroup={editGroup}
                config={parcelConfig}
                setConfig={setParcelConfig}
                onCancel={() => {
                  setEditorMode('none')
                  setEditGroup(null)
                }}
                onDeleteParcel={() => {
                  setEditorMode('none')
                  setEditGroup(null)
                  setSelectedItemId(null)
                }}
              />
            ) : null}
            {showElementPanel && propertiesElement ? (
              <ElementForm
                element={propertiesElement}
                onPatch={handleElementPatch}
                onDelete={handleElementDelete}
                onClose={() => setPropertiesOpenId(null)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
