'use client'

import React from 'react'
import type { FleetDevice } from './queries'
import type { DeviceHealth } from './device-health'

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

export default function DevicesView({ devices }: { devices: FleetDevice[] }) {
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
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-b border-gray-50 last:border-0">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
