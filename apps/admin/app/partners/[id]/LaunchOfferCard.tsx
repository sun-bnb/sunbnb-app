"use client"

import { useState } from "react"
import { grantPartnerPromotion, revokePartnerPromotion } from "./actions"

export interface LaunchOfferState {
  startedAt: string | null
  endsAt: string | null
  revokedAt: string | null
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

/**
 * Launch offer status (track 027 D9): no commission and no plan fees for 30 days from the
 * partner's first LIVE paid booking. Shows the real state the charge path reads, and lets a sudo
 * admin grant it by hand or revoke it.
 */
export default function LaunchOfferCard({ accountId, initial }: { accountId: string; initial: LaunchOfferState | null }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const now = Date.now()
  const status = !state
    ? { label: "Not granted", tone: "text-gray-500" }
    : state.revokedAt
      ? { label: `Revoked ${fmt(state.revokedAt)}`, tone: "text-red-400" }
      : !state.startedAt
        ? { label: "Granted — waiting for the first live paid booking", tone: "text-amber-400" }
        : new Date(state.endsAt!).getTime() > now
          ? { label: `Running — free until ${fmt(state.endsAt!)}`, tone: "text-green-400" }
          : { label: `Ended ${fmt(state.endsAt!)}`, tone: "text-gray-400" }
  const active = state && !state.revokedAt

  async function run(action: "grant" | "revoke") {
    setBusy(true)
    setError(null)
    const res = action === "grant" ? await grantPartnerPromotion(accountId) : await revokePartnerPromotion(accountId)
    setBusy(false)
    if (res.status !== "ok") return setError(res.errors?.join(", ") ?? "Failed")
    setState(
      action === "grant"
        ? { startedAt: state?.startedAt ?? null, endsAt: state?.endsAt ?? null, revokedAt: null }
        : { startedAt: state?.startedAt ?? null, endsAt: state?.endsAt ?? null, revokedAt: new Date().toISOString() },
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Launch offer</h3>
          <p className="mt-0.5 text-xs text-gray-500">No commission and no plan fees for 30 days from the first live paid booking.</p>
          <p className={`mt-2 text-sm ${status.tone}`} role="status">
            {status.label}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(active ? "revoke" : "grant")}
          className="shrink-0 rounded border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50"
        >
          {active ? "Revoke" : "Grant"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
