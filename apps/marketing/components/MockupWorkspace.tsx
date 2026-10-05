'use client'

import { useState } from 'react'
import type { LeadLayout } from '@repo/data/lead-model'
import ChatPanel from './ChatPanel'
import DemoRequestForm from './DemoRequestForm'
import MockupView from './MockupView'
import StickyCta from './StickyCta'

/**
 * Client shell of the mockup page: owns the sunbed count so a count the prospect gives in the chat
 * ("actually we have 140") redraws the map without a reload.
 */
export default function MockupWorkspace(props: {
  token: string
  apiKey: string
  center: { lat: number; lng: number }
  initialSunbedCount: number
  saved: LeadLayout | null
  beachName: string
  shareHint: string
  chatEnabled: boolean
  variant: 'a' | 'b'
}) {
  const [sunbedCount, setSunbedCount] = useState(props.initialSunbedCount)
  return (
    <>
      <MockupView token={props.token} apiKey={props.apiKey} center={props.center} sunbedCount={sunbedCount} saved={props.saved} />
      <p className="mt-2 text-xs text-gray-400">{props.shareHint}</p>

      <div className={`mt-10 grid gap-6 ${props.chatEnabled ? 'lg:grid-cols-2' : 'mx-auto max-w-xl'}`}>
        {props.chatEnabled && <ChatPanel token={props.token} beachName={props.beachName} onSunbedCount={setSunbedCount} />}
        <div id="demo">
          <DemoRequestForm token={props.token} beachName={props.beachName} />
        </div>
      </div>
      {/* Variant B (start free) gets its own CTA in P13; until then both arms book a demo. */}
      <StickyCta targetId="demo" />
    </>
  )
}
