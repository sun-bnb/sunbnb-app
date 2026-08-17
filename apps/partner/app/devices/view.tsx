'use client'

import React, { useState, useTransition } from 'react'
import type { FleetDevice } from './queries'
import type { DeviceHealth } from './device-health'
import {
  assignDeviceLocation,
  unassignDevice,
  identifyDevice,
  setDeviceSegmentOrder,
} from './actions'

/**
 * The fleet list (track 021 P5, step 4). Read-only for now — assignment lands
 * in step 5. It exists first because a device must be VISIBLE before anyone can
 * assign it a location, and because "which of these is dark" is the question an
 * operator asks before any other.
 */

const HEALTH: Record<DeviceHealth, { label: string; hint: string; classes: string }> = {
  ok: {
    label: 'OK',
    hint: 'Running the location it was assigned',
    classes: 'bg-green-50 border-green-200 text-green-700',
  },
  pending: {
    label: 'Not applied',
    hint: 'Assigned, but the device has not confirmed it yet — asleep, out of range, or dead',
    classes: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  unassigned: {
    label: 'Unassigned',
    hint: 'Reporting in, but no location yet — it lights nothing until assigned',
    classes: 'bg-blue-50 border-blue-200 text-blue-700',
  },
  silent: {
    label: 'Silent',
    hint: 'Not heard from in over 24 hours',
    classes: 'bg-red-50 border-red-200 text-red-600',
  },
  'never-seen': {
    label: 'Never seen',
    hint: 'Provisioned but has never reported — not installed, or never joined Wi-Fi',
    classes: 'bg-gray-50 border-gray-200 text-gray-600',
  },
}

const BATTERY: Record<FleetDevice['battery'], string> = {
  ok: 'text-gray-700',
  low: 'text-amber-600',
  critical: 'text-red-600',
  unknown: 'text-gray-400',
}

function relative(date: Date | null): string {
  if (!date) return 'never'
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function DevicesView({
  devices,
  sites,
}: {
  devices: FleetDevice[]
  sites: { id: string; name: string }[]
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Assignment is typed as the address painted on the bed — `parcel-row-unit`.
   * The server refuses an address that holds no unit, which is the mistake that
   * would otherwise only surface as an amber light on a beach.
   */
  const submit = (deviceId: string, form: HTMLFormElement) => {
    const data = new FormData(form)
    const parts = String(data.get('location') ?? '').split('-').map((p) => Number(p.trim()))
    if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
      setError('Enter a location as parcel-row-unit, for example 1-10-3')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await assignDeviceLocation(deviceId, {
        siteId: String(data.get('siteId') ?? ''),
        parcel: parts[0]!, row: parts[1]!, seq: parts[2]!,
      })
      if (res.status === 'error') setError(res.errors?.[0] ?? 'Could not assign')
      else setEditing(null)
    })
  }

  const counts = devices.reduce<Record<string, number>>((acc, d) => {
    acc[d.health] = (acc[d.health] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="container mx-auto max-w-[900px] px-4 py-6">
      <h1 className="text-xl font-semibold text-gray-900">Devices</h1>
      <p className="mt-1 text-sm text-gray-500">
        Sunbed indicators report in on their own. Assign each one the spot it is mounted on.
      </p>

      {devices.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
          No devices yet. They appear here automatically the first time they connect.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.keys(HEALTH) as DeviceHealth[])
              .filter((h) => counts[h])
              .map((h) => (
                <span
                  key={h}
                  title={HEALTH[h].hint}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${HEALTH[h].classes}`}
                >
                  {counts[h]} {HEALTH[h].label.toLowerCase()}
                </span>
              ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Last seen</th>
                  <th className="px-4 py-2 font-medium">Battery</th>
                  <th className="px-4 py-2 font-medium">Signal</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <React.Fragment key={device.id}>
                  <tr className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 font-mono text-gray-900">{device.code}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {device.assignedLocation ?? <span className="text-gray-400">—</span>}
                      {/* The gap between assigned and applied is the whole point
                          of showing both: a device can be told where it is and
                          not have heard yet. */}
                      {device.health === 'pending' && device.reportedLocation && (
                        <span className="ml-2 text-xs text-amber-600">
                          running {device.reportedLocation}
                        </span>
                      )}
                      {/* A device asserting a different customer: recorded, never
                          acted on, and shown because an unseen claim is the same
                          as no claim. Usually a reflashed unit; occasionally not. */}
                      {device.claimedPartnerCode && (
                        <span
                          title={`This device reports it belongs to ${device.claimedPartnerCode}. Nothing was changed — contact support if it is not yours.`}
                          className="ml-2 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600"
                        >
                          claims {device.claimedPartnerCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        title={HEALTH[device.health].hint}
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${HEALTH[device.health].classes}`}
                      >
                        {HEALTH[device.health].label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{relative(device.lastSeenAt)}</td>
                    <td className={`px-4 py-2 ${BATTERY[device.battery]}`}>
                      {device.battMv ? `${(device.battMv / 1000).toFixed(2)}V` : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {device.rssiDbm != null ? `${device.rssiDbm} dBm` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => { setError(null); setEditing(editing === device.id ? null : device.id) }}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {device.assignedLocation ? 'Move' : 'Assign'}
                      </button>
                      {device.assignedLocation && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => startTransition(async () => { await identifyDevice(device.id) })}
                          title="Flashes the bar on the next poll, so you can confirm which box this is"
                          className="ml-2 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Identify
                        </button>
                      )}
                    </td>
                  </tr>
                  {editing === device.id && (
                    <tr className="border-b border-gray-50 bg-gray-50/60">
                      <td colSpan={7} className="px-4 py-3">
                        <form
                          onSubmit={(e) => { e.preventDefault(); submit(device.id, e.currentTarget) }}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <select
                            name="siteId"
                            defaultValue={device.assignedSiteId ?? sites[0]?.id ?? ''}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                          >
                            {sites.map((site) => (
                              <option key={site.id} value={site.id}>{site.name}</option>
                            ))}
                          </select>
                          <input
                            name="location"
                            defaultValue={device.assignedLocation ?? ''}
                            placeholder="parcel-row-unit, e.g. 1-10-3"
                            className="w-56 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                          />
                          <button
                            type="submit"
                            disabled={pending}
                            className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                          >
                            {pending ? 'Saving…' : 'Save'}
                          </button>
                          {device.assignedLocation && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => startTransition(async () => {
                                await unassignDevice(device.id); setEditing(null)
                              })}
                              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:bg-white"
                            >
                              Unassign
                            </button>
                          )}
                          <label className="flex items-center gap-1.5 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              defaultChecked={device.reverseSegments}
                              disabled={pending}
                              onChange={(e) => {
                                const reversed = e.currentTarget.checked
                                startTransition(async () => {
                                  await setDeviceSegmentOrder(device.id, reversed)
                                })
                              }}
                            />
                            Bar mounted the other way round
                          </label>
                          <span className="text-xs text-gray-500">
                            Saving flashes the bar — watch the parasol to confirm it is this one.
                          </span>
                        </form>
                        {error && (
                          <p role="status" className="mt-2 text-sm text-red-600">{error}</p>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
