'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ProposalInfo } from './stream-reducer'
import {
  DELETE_CONFIRM_WORD,
  STATUS_TONE,
  canApply,
  canUndo,
  compactPreview,
  describeCreate,
  formatValue,
  humanizeKey,
  type FieldRow,
  type ParcelPosition,
  hasDeletes,
  parsePreview,
  parseImagePreview,
  uploadThumbSrc,
  type ImagePreview,
  type PreviewScalar,
  type ProposalErrorCode,
} from './proposal-model'
import { runProposalOp, type ProposalOp } from './proposal-actions'
import { GEOMETRY_KINDS, hasRemovals, parseGeometry, summaryParts, type GeometryPreview } from './geometry-preview'
import { dispatch } from './assistant-store'
import { dispatchPreview } from './preview-store'
import { useActivePreview } from './useGhostPreview'
import { useAssistantPageContext } from './AssistantContext'

const DESKTOP_QUERY = '(min-width: 1024px)'

/** "N added · M moved · K removed" + show/hide on the map (track 030 S4b). */
function MapPreviewControls({ siteId, actionId, geo, proposed }: { siteId: string; actionId: string; geo: GeometryPreview; proposed: boolean }) {
  const t = useTranslations('Assistant.preview')
  const router = useRouter()
  const getContext = useAssistantPageContext()
  const { active } = useActivePreview(siteId)
  const showing = active?.actionId === actionId
  const onMapTab = ['inventory', 'schematic'].includes(getContext().tab ?? '')
  const el = geo.elements
  const parts = summaryParts({
    added: geo.added.length + el.added.length,
    moved: geo.moved.length + el.moved.length,
    removed: geo.removed.length + el.removed.length,
  })
  // Layout elements can be resized / recoloured too, not only moved: "changed".
  const movedKey = el.moved.length > 0 ? 'changed' : 'moved'
  const mapHref = `/sites/${siteId}/${geo.mode === 'schematic' ? 'schematic' : 'inventory'}`

  const isPhone = () => !window.matchMedia(DESKTOP_QUERY).matches
  const show = (peek: boolean) => {
    dispatchPreview(siteId, { type: 'show', actionId, peek })
    if (peek) dispatch(siteId, { type: 'close' })
  }

  return (
    <div className="space-y-2">
      {parts.length > 0 && (
        <p className="text-xs font-medium text-gray-700">
          {parts.map((p) => t(`count.${p.key === 'moved' ? movedKey : p.key}`, { count: p.n })).join(' \u00b7 ')}
        </p>
      )}
      {proposed && (
        <div className="flex flex-wrap gap-2">
          {onMapTab ? (
            <>
              <button
                type="button"
                aria-pressed={showing}
                onClick={() => (showing ? dispatchPreview(siteId, { type: 'hide', actionId }) : show(false))}
                className="btn-ghost min-h-[40px] border border-blue-200 bg-blue-50 text-xs text-blue-700 lg:min-h-0"
              >
                {showing ? t('hide') : t('show')}
              </button>
              <button type="button" onClick={() => show(true)} className="btn-ghost min-h-[40px] border border-gray-200 text-xs lg:hidden">
                {t('viewOnMap')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                const peek = isPhone()
                dispatchPreview(siteId, { type: 'show', actionId, peek })
                if (peek) dispatch(siteId, { type: 'close' })
                router.push(mapHref)
              }}
              className="btn-ghost min-h-[40px] border border-blue-200 bg-blue-50 text-xs text-blue-700 lg:min-h-0"
            >
              {t('openOnMap')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Value({ v, strike = false, emphasis = false }: { v: PreviewScalar; strike?: boolean; emphasis?: boolean }) {
  const t = useTranslations('Assistant.proposal')
  const [expanded, setExpanded] = useState(false)
  const f = formatValue(v, expanded)
  const tone = strike ? 'text-gray-400 line-through' : emphasis ? 'font-medium text-gray-900' : 'text-gray-700'
  if (f.kind === 'empty') return <span className="text-gray-400">{t('empty')}</span>
  if (f.kind === 'bool') return <span className={tone}>{f.value ? t('on') : t('off')}</span>
  return (
    <span className={`break-words ${tone}`}>
      {f.text}
      {(f.truncated || expanded) && f.full.length > 60 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="ml-1 text-xs font-normal text-blue-600 no-underline hover:underline"
        >
          {expanded ? t('less') : t('more')}
        </button>
      )}
    </span>
  )
}

/** One side of the before / after: a thumbnail, or text when there is none / it fails to load. */
function Thumb({ src, label, emptyText }: { src: string | null; label: string; emptyText: string }) {
  const t = useTranslations('Assistant.proposal.image')
  const [failed, setFailed] = useState(false)
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="mb-1 text-[0.7rem] uppercase tracking-wide text-gray-400">{label}</figcaption>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} onError={() => setFailed(true)} className="h-24 w-full rounded-lg border border-gray-200 bg-gray-50 object-cover" />
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-2 text-center text-xs text-gray-400">
          {src && failed ? t('unavailable') : emptyText}
        </div>
      )}
    </figure>
  )
}

function ImageChange({ image }: { image: ImagePreview }) {
  const t = useTranslations('Assistant.proposal.image')
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 p-2">
      <Thumb src={image.previousUrl} label={t('current')} emptyText={t('none')} />
      <span aria-hidden="true" className="text-gray-400">→</span>
      <Thumb src={image.uploadId ? uploadThumbSrc(image.uploadId) : null} label={t('new')} emptyText={t('unavailable')} />
    </div>
  )
}

/** Extra / unknown fields as label-value rows: translated label when known, humanized key otherwise. */
function FieldList({ rows }: { rows: FieldRow[] }) {
  const t = useTranslations('Assistant.proposal.create')
  if (!rows.length) return null
  return (
    <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <dt className="text-gray-500">{t.has(`fields.${r.key}`) ? t(`fields.${r.key}`) : r.fallbackLabel}</dt>
          <dd className="min-w-0"><Value v={r.value} /></dd>
        </div>
      ))}
    </dl>
  )
}

function positionText(pos: ParcelPosition, t: ReturnType<typeof useTranslations>): string | null {
  if (!pos) return null
  return pos.kind === 'schematic' ? t('schematicAt', { x: pos.x, y: pos.y }) : t('onMap')
}

/** One "will be created" entry: parcels and layout elements read as a sentence, the rest as fields. */
function CreateRow({ target, fields }: { target: string; fields: Record<string, PreviewScalar> }) {
  const t = useTranslations('Assistant.proposal.create')
  const v = describeCreate(fields)
  if (v.kind === 'parcel') {
    const shape = [
      t('parcelShape', { rows: v.rows, perRow: v.perRow }) + (v.paired ? ` (${t('paired')})` : ''),
      v.rows > 1 && v.total !== null ? t('total', { count: v.total }) : null,
      v.rotation !== null ? t('rotated', { degrees: v.rotation }) : null,
    ].filter(Boolean)
    const where = positionText(v.position, t)
    return (
      <>
        <p className="font-medium text-gray-900">{target}</p>
        <p className="mt-0.5 text-gray-700">{shape.join(' \u00b7 ')}</p>
        {where && (
          <p className="text-gray-400" title={v.position?.kind === 'geo' ? v.position.text : undefined}>{where}</p>
        )}
        <FieldList rows={v.extras} />
      </>
    )
  }
  if (v.kind === 'element') {
    const type = t.has(`types.${v.type}`) ? t(`types.${v.type}`) : humanizeKey(v.type)
    const geometry = [
      t('elementShape', { width: v.width, height: v.height, x: v.x, y: v.y }),
      v.rotation !== null ? t('rotated', { degrees: v.rotation }) : null,
    ].filter(Boolean)
    return (
      <>
        <p className="font-medium text-gray-900">{v.label ? t('elementTitle', { type, label: v.label }) : type}</p>
        <p className="mt-0.5 text-gray-700">{geometry.join(' \u00b7 ')}</p>
        <FieldList rows={v.extras} />
      </>
    )
  }
  return (
    <>
      <p className="font-medium text-gray-900">{target}</p>
      <FieldList rows={v.fields} />
    </>
  )
}

export default function ProposalCard({ proposal, siteId }: { proposal: ProposalInfo; siteId: string }) {
  const t = useTranslations('Assistant.proposal')
  const ti = useTranslations('Assistant.proposal.image')
  const router = useRouter()
  const full = parsePreview(proposal.preview)
  // A done card is a receipt: a short change list, not the whole review.
  const compact = proposal.status === 'applied' ? compactPreview(full) : { preview: full, hidden: 0 }
  const preview = compact.preview
  const image = parseImagePreview(proposal.preview)
  const geo = GEOMETRY_KINDS.includes(proposal.kind) ? parseGeometry(proposal.preview) : null
  const [pending, setPending] = useState<ProposalOp | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<ProposalErrorCode | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { status } = proposal
  const deletes = hasDeletes(preview)
  const busy = pending !== null
  const empty = !image && !preview.changes.length && !preview.creates.length && !deletes

  const run = async (op: ProposalOp) => {
    setPending(op)
    setError(null)
    setNotice(null)
    const out = await runProposalOp(siteId, op, proposal)
    setPending(null)
    if (out.ok) {
      setNotice(out.summary || t(`done.${op}`))
      if (op !== 'reject') router.refresh()
    } else {
      setError(out.code)
      // Undo refused because the window passed: nothing more to offer.
      if (out.code === 'undo_window') setNotice(null)
    }
  }

  const undoable = canUndo(status, preview, proposal.appliedAt) && error !== 'undo_window'

  return (
    <section
      aria-label={t('title')}
      className="w-full min-w-0 space-y-2.5 rounded-xl border border-gray-200 bg-white p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-900">{image && image.fileName ? ti(`title.${image.target}`, { file: image.fileName, name: image.itemName }) : proposal.summary}</h3>
        <span className={`badge shrink-0 border ${STATUS_TONE[status]}`}>{t(`status.${status}`)}</span>
      </div>

      {preview.warnings.length > 0 && (
        <ul role="status" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {/* Ghosts exist only for a pending delete (to show what would go); applied cards have no preview. */}
      {geo && status === 'proposed' && hasRemovals(geo) && <MapPreviewControls siteId={siteId} actionId={proposal.actionId} geo={geo} proposed />}

      {image && <ImageChange image={image} />}

      {!image && preview.changes.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100" aria-label={t('changes')}>
          {preview.changes.map((c, i) => (
            <li key={i} className="px-2.5 py-2 text-xs sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-2">
              <div className="min-w-0">
                <p className="truncate text-[0.7rem] uppercase tracking-wide text-gray-400">{c.target}</p>
                <p className="font-medium text-gray-700">{c.label}</p>
              </div>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 sm:mt-0">
                <Value v={c.before} strike />
                <span aria-hidden="true" className="text-gray-400">→</span>
                <span className="sr-only">{t('to')}</span>
                <Value v={c.after} emphasis />
              </p>
            </li>
          ))}
        </ul>
      )}

      {preview.creates.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-green-700">{t('creates')}</p>
          <ul className="space-y-1.5">
            {preview.creates.map((c, i) => (
              <li key={i} className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-2 text-xs">
                <CreateRow target={c.target} fields={c.fields} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {compact.hidden > 0 && <p className="text-xs text-gray-400">{t('moreChanges', { count: compact.hidden })}</p>}

      {deletes && (
        <div>
          <p className="mb-1 text-xs font-medium text-red-700">{t('deletes')}</p>
          <ul className="space-y-1.5">
            {preview.deletes.map((d, i) => (
              <li key={i} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                <span className="font-medium">{d.target}</span>
                {d.label && <span> · {d.label}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {empty && preview.warnings.length === 0 && <p className="text-xs text-gray-400">{t('noPreview')}</p>}

      {status === 'proposed' && deletes && (
        <div>
          <label htmlFor={`confirm-${proposal.actionId}`} className="block text-xs text-gray-600">
            {t('typeToConfirm', { word: DELETE_CONFIRM_WORD })}
          </label>
          <input
            id={`confirm-${proposal.actionId}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            disabled={busy}
            className="input mt-1"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {t(`errors.${error}`)}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          {notice}
        </p>
      )}

      {status === 'proposed' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run('apply')}
            disabled={busy || !canApply(preview, typed)}
            className="btn-primary min-h-[40px] py-1.5 text-xs lg:min-h-0"
          >
            {pending === 'apply' ? t('applying') : t('apply')}
          </button>
          <button
            type="button"
            onClick={() => run('reject')}
            disabled={busy}
            className="btn-ghost min-h-[40px] text-xs lg:min-h-0"
          >
            {pending === 'reject' ? t('rejecting') : t('reject')}
          </button>
        </div>
      )}
      {undoable && (
        <div>
          <button
            type="button"
            onClick={() => run('undo')}
            disabled={busy}
            className="btn-ghost min-h-[40px] text-xs lg:min-h-0"
          >
            {pending === 'undo' ? t('undoing') : t('undo')}
          </button>
        </div>
      )}
    </section>
  )
}
