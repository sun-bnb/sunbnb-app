'use client'

/**
 * BeachScene — the landing page's world, in WebGL.
 *
 * A stylised beach club built from the parts the real reservation map draws:
 * a white octagonal canopy on a pole between two loungers on a green frame, a
 * coral towel on the ones that are taken. Loungers face the sea (-z): backrest
 * and parasol at the land end, feet to the water. It is driven by ONE number, the
 * page's scroll progress `p` in [0, 1], which the parent writes into a ref:
 *
 *   p = 0     straight down — this IS the map the product uses — morning light
 *   p ≈ 0.1   the map stands up into a wide tilted view
 *   p ≈ 0.2   gliding over the rows toward the seat; a free unit is claimed ("Yours")
 *   p ≈ 0.36  arrive at the parasol; slow turn around its status device — noon
 *   p ≈ 0.7   slow turn around the drinks table on the far side — golden hour
 *   p ≈ 0.92  back to the middle of the boardwalk, then out low and straight
 *   p = 1     dusk: parasols fold, string lights come on along the boardwalk
 *
 * Camera, sun, sky, sea and sand are all functions of p (Catmull-Rom through
 * keyframes for the camera, linear for colours), smoothed a little each frame
 * so scrolling feels filmed rather than scrubbed. Hovering/tapping a free unit
 * moves the "Yours" tag; that is the only interaction.
 *
 * Each pole carries the seat-side status device (the box from the marketing
 * page, `apps/marketing/components/DeviceShowcase.tsx`): a colour wheel behind a
 * fan-shaped window — green free, red reserved, blue occupied — over the seat's
 * QR code. The claimed unit's wheel follows the story: free, reserved once it is
 * claimed, occupied when the drinks arrive, free again at dusk.
 *
 * Geometry note: the pole stands BETWEEN the two beds (`POLE_Z`), not at the
 * sea end — a canopy 2 m up at the head end projected onto the water from any
 * tilted angle, which is what made the first cut look misaligned. The club
 * also keeps a real strip of sand to the shoreline for the same reason.
 *
 * Budget: shared geometries/materials, ~300 draw calls, one 1024² shadow map,
 * `dpr` ≤ 1.75. The parent pauses the frameloop when the stage is off-screen
 * and decides what to show without WebGL; this component assumes it exists.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// ── Palette ──────────────────────────────────────────────────────────────────
const CANOPY = '#fbf8f0'
const CANOPY_EDGE = '#e6dcc6'
const POLE = '#cdb98e'
const FRAME = '#3f8c52' // the map icon's green
const CUSHION = '#f8f3e6'
const TOWEL = '#e2866a' // the map's towel
const WOOD = '#dcbd84'
const FOAM = '#ffffff'
const GLOW = '#00cef1'
const BULB = '#ffd27a'
const DEVICE_WHITE = '#f4f2ec'
const STATUS_COLOR = { reserved: '#e5372e', occupied: '#2f7de1', free: '#76c92f' } as const

// ── Layout ───────────────────────────────────────────────────────────────────
const COLS = 4
const ROWS = 4
const DX = 2.75
const DZ = 3.35
const WALK_W = 2.6
const SHORE_Z = -12.5 // sea is -z
const POLE_Z = 0.35 // between the beds at the head end — the LAND side: you lie facing the sea

interface UnitSpec {
  id: number
  x: number
  z: number
  taken: boolean
}

/** Deterministic occupancy — about two thirds taken, free ones scattered. */
const TAKEN_PATTERN = [
  1, 1, 0, 1, 1, 1, 1, 0,
  1, 0, 1, 1, 0, 1, 1, 1,
  1, 1, 1, 0, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 0, 1, 1,
]

function buildUnits(): UnitSpec[] {
  const units: UnitSpec[] = []
  let id = 0
  for (let r = 0; r < ROWS; r++) {
    for (const side of [-1, 1]) {
      for (let c = 0; c < COLS; c++) {
        const x = side * (WALK_W / 2 + 1.5 + c * DX)
        const z = (r - (ROWS - 1) / 2) * DZ
        units.push({ id, x, z, taken: TAKEN_PATTERN[id % TAKEN_PATTERN.length] === 1 })
        id++
      }
    }
  }
  return units
}

const UNITS = buildUnits()
/** The unit the story claims: first one right of the walkway, second row. */
const CLAIMED_ID = 12
const CLAIMED = UNITS[CLAIMED_ID]!

// ── Time of day: everything below is a function of p ────────────────────────
type Key = { p: number; v: number[] }
function lerpKeys(keys: Key[], p: number, out: number[]) {
  let a = keys[0]!
  let b = keys[keys.length - 1]!
  for (let i = 0; i < keys.length - 1; i++) {
    if (p >= keys[i]!.p && p <= keys[i + 1]!.p) {
      a = keys[i]!
      b = keys[i + 1]!
      break
    }
  }
  const k = b.p === a.p ? 0 : THREE.MathUtils.clamp((p - a.p) / (b.p - a.p), 0, 1)
  for (let i = 0; i < a.v.length; i++) out[i] = a.v[i]! + (b.v[i]! - a.v[i]!) * k
  return out
}
const hex = (h: string) => {
  const c = new THREE.Color(h)
  return [c.r, c.g, c.b]
}

// sun position + intensity
const SUN: Key[] = [
  { p: 0, v: [10, 22, 10, 2.2] },
  { p: 0.5, v: [3, 26, 3, 2.7] },
  { p: 0.78, v: [-20, 7, 6, 2.1] },
  { p: 0.9, v: [-24, 2.5, 6, 0.9] },
  { p: 1, v: [-26, 1.2, 6, 0.25] },
]
const SUN_COLOR: Key[] = [
  { p: 0, v: hex('#fff4dc') },
  { p: 0.5, v: hex('#ffffff') },
  { p: 0.78, v: hex('#ffb86e') },
  { p: 1, v: hex('#ff8f6a') },
]
const SKY: Key[] = [
  { p: 0, v: hex('#f8efdc') },
  { p: 0.5, v: hex('#eef7fa') },
  { p: 0.78, v: hex('#f9d9ae') },
  { p: 0.9, v: hex('#8d6b8c') },
  { p: 1, v: hex('#2a2e4b') },
]
const AMBIENT: Key[] = [
  { p: 0, v: [0.5] },
  { p: 0.5, v: [0.6] },
  { p: 0.78, v: [0.45] },
  { p: 1, v: [0.22] },
]
const HEMI_SKY: Key[] = [
  { p: 0, v: hex('#eaf7fb') },
  { p: 0.78, v: hex('#ffd9b0') },
  { p: 1, v: hex('#3b3f6e') },
]
const SAND: Key[] = [
  { p: 0, v: hex('#f6e7c5') },
  { p: 0.5, v: hex('#f9edd2') },
  { p: 0.78, v: hex('#f2d7a9') },
  { p: 0.9, v: hex('#a9909c') },
  { p: 1, v: hex('#6d6b86') },
]
const SAND_WET: Key[] = [
  { p: 0, v: hex('#dcc394') },
  { p: 0.78, v: hex('#d9b98a') },
  { p: 1, v: hex('#55587a') },
]
const SEA_DEEP: Key[] = [
  { p: 0, v: hex('#0b93b0') },
  { p: 0.5, v: hex('#0a9bbd') },
  { p: 0.78, v: hex('#1f87a8') },
  { p: 1, v: hex('#1b3556') },
]
const SEA_SHALLOW: Key[] = [
  { p: 0, v: hex('#79dcec') },
  { p: 0.5, v: hex('#8ae6f2') },
  { p: 0.78, v: hex('#ffc693') },
  { p: 1, v: hex('#5c7391') },
]

// ── Camera path ─────────────────────────────────────────────────────────────
// Each key carries the scroll position it is reached at, so a segment can be
// slow (the QR turn, the drinks) or quick (the hops between). Catmull-Rom runs
// over the key index; `tOfP` maps scroll → index, piecewise-linear.
//
//   0.00 the map · 0.09 wide · 0.17–0.26 gliding over the rows toward the seat
//   0.36 arrive at the parasol from the walkway side, the status device in view
//   0.36–0.62 slow turn around the device, staying on its front (the back is blank)
//   0.68–0.86 slow turn around the drinks table on the far side
//   0.86–0.95 spiral in to the middle of the boardwalk, still turning, to face the sea
//   1.00 backed out low and straight along the boardwalk
const DEVICE_AT = new THREE.Vector3(CLAIMED.x, 1.3, CLAIMED.z + POLE_Z + 0.08)
/** The side table, beside the right-hand lounger at the head end (see Drinks). */
const TABLE = new THREE.Vector3(CLAIMED.x + 1.08, 0.45, CLAIMED.z + 0.55)
/** A point on a circle around `c`: φ 0 = land side (+z), 90° = +x, 180° = sea. */
const around = (c: THREE.Vector3, deg: number, r: number, h: number) => {
  const a = (deg * Math.PI) / 180
  return new THREE.Vector3(c.x + Math.sin(a) * r, h, c.z + Math.cos(a) * r)
}
const UNIT_C = new THREE.Vector3(CLAIMED.x, 0, CLAIMED.z + POLE_Z)
const TABLE_C = new THREE.Vector3(TABLE.x, 0, TABLE.z)
const tableLook = new THREE.Vector3(TABLE.x, TABLE.y + 0.18, TABLE.z)
/** The middle of the boardwalk, level with the claimed row. */
const WALK_C = new THREE.Vector3(0, 0, CLAIMED.z + 0.5)
/** The spiral window: the drinks turn keeps rotating (φ 165° → 360°) while the
 *  orbit centre slides from the table to the boardwalk and the radius closes to
 *  zero, so the camera arrives at the boardwalk's middle facing the sea with no
 *  change of turn direction. */
const SPIRAL_IN = 0.86
const SPIRAL_OUT = 0.95

const KEYS: { p: number; pos: THREE.Vector3; look: THREE.Vector3 }[] = [
  { p: 0.0, pos: new THREE.Vector3(0, 36, 4.5), look: new THREE.Vector3(0, 0, -2.5) },
  { p: 0.09, pos: new THREE.Vector3(2.0, 12, 27), look: new THREE.Vector3(0.6, 0.2, -5) },
  { p: 0.17, pos: new THREE.Vector3(7.5, 4.6, 9.5), look: new THREE.Vector3(CLAIMED.x + 3.2, 0.9, CLAIMED.z - 1) },
  { p: 0.26, pos: new THREE.Vector3(CLAIMED.x - 4.5, 3.2, CLAIMED.z + 6.5), look: new THREE.Vector3(CLAIMED.x, 1.0, CLAIMED.z) },
  // the device faces ~326° (toward the walkway); the turn stays on that side
  { p: 0.36, pos: around(UNIT_C, 282, 2.6, 1.8), look: DEVICE_AT.clone() },
  { p: 0.5, pos: around(UNIT_C, 326, 2.1, 1.55), look: DEVICE_AT.clone() },
  { p: 0.62, pos: around(UNIT_C, 14, 2.2, 1.5), look: DEVICE_AT.clone() },
  // quick hop to the far side, then a slow turn around the table
  { p: 0.68, pos: around(TABLE_C, 10, 1.45, 1.1), look: tableLook.clone() },
  { p: 0.78, pos: around(TABLE_C, 90, 1.35, 1.05), look: tableLook.clone() },
  { p: 0.86, pos: around(TABLE_C, 165, 1.3, 1.0), look: tableLook.clone() },
  // 0.86–0.95 is the spiral (see Rig): same turn direction, in to the boardwalk,
  // facing the sea on arrival. Then straight out along it.
  { p: SPIRAL_OUT, pos: WALK_C.clone().setY(1.9), look: new THREE.Vector3(0, 0.8, WALK_C.z - 10) },
  { p: 1.0, pos: new THREE.Vector3(0, 2.2, 26), look: new THREE.Vector3(0, 1.0, -8) },
]
const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.pos), false, 'centripetal')
const lookCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.look), false, 'centripetal')
/** Scroll position → curve parameter: key i sits at t = i/(n-1), linear in between. */
function tOfP(p: number) {
  const n = KEYS.length
  for (let i = 0; i < n - 1; i++) {
    const a = KEYS[i]!.p
    const b = KEYS[i + 1]!.p
    if (p <= b) return (i + (p - a) / (b - a)) / (n - 1)
  }
  return 1
}

// ── Shared geometry / material ───────────────────────────────────────────────
function useParts() {
  return useMemo(() => {
    const geo = {
      canopy: new THREE.ConeGeometry(1.18, 0.5, 8, 1, false),
      canopyRim: new THREE.CylinderGeometry(1.18, 1.18, 0.05, 8, 1, true),
      pole: new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8),
      frame: new THREE.BoxGeometry(0.8, 0.08, 2.0),
      cushion: new THREE.BoxGeometry(0.7, 0.14, 1.72),
      backrest: new THREE.BoxGeometry(0.7, 0.12, 0.62),
      towel: new THREE.BoxGeometry(0.5, 0.03, 1.05),
      ring: new THREE.RingGeometry(1.3, 1.5, 48),
      hit: new THREE.BoxGeometry(2.4, 2.4, 2.3),
      ...deviceGeometry(),
      table: new THREE.BoxGeometry(0.44, 0.42, 0.44),
    }
    const mat = {
      canopy: new THREE.MeshStandardMaterial({ color: CANOPY, roughness: 0.9, flatShading: true }),
      canopyRim: new THREE.MeshStandardMaterial({ color: CANOPY_EDGE, roughness: 0.9, side: THREE.DoubleSide }),
      pole: new THREE.MeshStandardMaterial({ color: POLE, roughness: 0.7 }),
      frame: new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.75 }),
      cushion: new THREE.MeshStandardMaterial({ color: CUSHION, roughness: 0.95 }),
      towel: new THREE.MeshStandardMaterial({ color: TOWEL, roughness: 1 }),
      hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      device: new THREE.MeshStandardMaterial({ color: DEVICE_WHITE, roughness: 0.7 }),
      solar: new THREE.MeshStandardMaterial({ color: '#141b27', roughness: 0.22, metalness: 0.35 }),
      wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
      print: new THREE.MeshStandardMaterial({ map: makePrintTexture(), transparent: true, roughness: 0.7 }),
      wood: new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 }),
    }
    return { geo, mat }
  }, [])
}
type Parts = ReturnType<typeof useParts>

// ── The status device ───────────────────────────────────────────────────────
// Proportioned from photos of the prototype, in the marketing model's units
// (260 × 236 × 110, window and print positions from DeviceShowcase.tsx) and
// scaled up a little past life size so it reads from the camera's orbit.
const DS = 0.34 / 260
const DEV_W = 260 * DS
const DEV_H = 236 * DS
const DEV_D = 110 * DS
const DEV_PLATE = 5 * DS
const DEV_LIP = 3 * DS
/** Window hub, 4 units higher than the marketing model so the whole wheel fits inside the plate. */
const DEV_HUB_Y = DEV_H / 2 - 137 * DS
const DEV_R_OUT = 97 * DS
const DEV_R_IN = 38 * DS
const DEV_HALF = (32 * Math.PI) / 180
/** The pole's radius plus half the box: the back plate sits against the pole. */
const DEV_OFFSET = 0.035 + DEV_D / 2

type DeviceStatus = keyof typeof STATUS_COLOR
/** Wheel order, clockwise from the window: each status is a third further on. */
const WHEEL_ORDER: DeviceStatus[] = ['reserved', 'occupied', 'free']

/** What a unit's device shows at scroll `p`. The claimed one lives the story's day. */
function deviceStatus(spec: UnitSpec, p: number): DeviceStatus {
  if (spec.id === CLAIMED_ID) return p < 0.2 ? 'free' : p < 0.56 ? 'reserved' : p < 0.95 ? 'occupied' : 'free'
  if (!spec.taken) return 'free'
  return spec.id % 3 === 0 ? 'reserved' : 'occupied'
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -h / 2)
  s.lineTo(w / 2 - r, -h / 2)
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  s.lineTo(w / 2, h / 2 - r)
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  s.lineTo(-w / 2 + r, h / 2)
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  s.lineTo(-w / 2, -h / 2 + r)
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  return s
}

/**
 * The device as three merged geometries — white body (core + both plates, the
 * front one with the window cut), dark solar panels (top + both sides), and the
 * wheel (three coloured thirds, vertex-coloured) — so each pole costs four draw
 * calls with the print. Front is +z, origin at the box's centre.
 */
function deviceGeometry() {
  const plate = (window: boolean) => {
    const shape = roundedRect(DEV_W, DEV_H, 12 * DS)
    if (window) {
      const hole = new THREE.Path()
      const up = Math.PI / 2
      hole.absarc(0, DEV_HUB_Y, DEV_R_OUT, up + DEV_HALF, up - DEV_HALF, true)
      hole.absarc(0, DEV_HUB_Y, DEV_R_IN, up - DEV_HALF, up + DEV_HALF, false)
      hole.closePath()
      shape.holes.push(hole)
    }
    return new THREE.ExtrudeGeometry(shape, { depth: DEV_PLATE, bevelEnabled: false, curveSegments: 10 })
  }
  const front = plate(true).translate(0, 0, DEV_D / 2 - DEV_PLATE)
  const back = plate(false).translate(0, 0, -DEV_D / 2)
  const coreW = DEV_W - 2 * DEV_LIP
  const coreH = DEV_H - 2 * DEV_LIP
  const coreD = DEV_D - 2 * DEV_PLATE
  const core = new THREE.BoxGeometry(coreW, coreH, coreD).toNonIndexed()
  const deviceBody = mergeGeometries([core, front, back])!

  const top = new THREE.BoxGeometry(DEV_W * 0.72, 0.004, coreD - 4 * DS).translate(0, coreH / 2 + 0.002, 0)
  const sideH = coreH * 0.74
  const sideY = -coreH / 2 + coreH * 0.05 + sideH / 2
  const side = (sign: number) => new THREE.BoxGeometry(0.004, sideH, coreD * 0.84).translate(sign * (coreW / 2 + 0.002), sideY, 0)
  const deviceSolar = mergeGeometries([top, side(1), side(-1)])!

  // Red centred on the window (straight up), then blue and green clockwise; turning the wheel
  // +120° (counter-clockwise, seen from the front) brings the next status up.
  const r = DEV_R_OUT + 1.5 * DS
  const thirds = WHEEL_ORDER.map((status, i) => {
    const g = new THREE.CircleGeometry(r, 24, Math.PI / 2 - Math.PI / 3 - (i * 2 * Math.PI) / 3, (2 * Math.PI) / 3).toNonIndexed()
    const c = new THREE.Color(STATUS_COLOR[status])
    const n = g.getAttribute('position').count
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3))
    return g
  })
  // Inside the front plate's thickness: only the window shows it.
  const deviceWheel = mergeGeometries(thirds)!
  const devicePrint = new THREE.PlaneGeometry(100 * DS, 100 * DS)
  return { deviceBody, deviceSolar, deviceWheel, devicePrint }
}

/** A QR-looking field: finder squares plus seeded modules. Not scannable, by design. */
function drawQr(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number) {
  const n = 21
  const cell = size / (n + 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x0, y0, size, size)
  let seed = 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  const at = (gx: number, gy: number, w: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x0 + (gx + 1) * cell, y0 + (gy + 1) * cell, w * cell, w * cell)
  }
  const finder = (gx: number, gy: number) => {
    at(gx, gy, 7, '#17323a')
    at(gx + 1, gy + 1, 5, '#ffffff')
    at(gx + 2, gy + 2, 3, '#17323a')
  }
  finder(0, 0)
  finder(n - 7, 0)
  finder(0, n - 7)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const inFinder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8)
      if (!inFinder && rnd() < 0.42) at(x, y, 1, '#17323a')
    }
  }
}

/** The Sunbnb mark (public/sunbnb-logo.svg, viewBox 303.75 × 277). */
const LOGO_PATHS = [
  'M230.82,91.37c1.94-10.69.1-21.9-2.88-32.26-2.91-10.46-8.12-20.21-16.13-27.59-21.04-19.52-52.56-28.09-80.62-22.8-21.16,3.94-39.99,17.29-51.74,35.19-23.89,35.28-15.27,91.34,26.87,108.13,23.52,10.28,51.35,10.49,75.76,19.52,13.02,4.78,25.53,12.03,34.51,22.95,0,0,.98,1.17.98,1.17,0,0,.49.58.49.58,3.54,3.97-.76,10.75-6.28,8.23-2.22-1.19-4.76-2.59-7.08-3.61-28.87-13.1-60.88-9.33-91.91-8.31-22.59.77-46.79-.03-67.95-9.66C23.72,173.41,5.58,155.21,0,132.33c0,0,3.65-1.04,3.65-1.04,4.45,13.87,13.69,25.76,25.29,34.38,54.49,40.4,127.63-3.84,186.54,29.48,0,0,.65.35.65.35,0,0,.16.09.16.09-.08-.04.41.22-.14-.07-2.69-1.45-6.37.47-6.73,3.47-.13.8-.03,1.73.3,2.51.5,1.03.78,1.24.56,1l-.1-.12s-.41-.49-.41-.49c-7.84-10-19.18-16.67-31.08-21.06-17.45-6.43-36.01-8.2-54.14-12.65-23.42-5.58-45.45-16.69-57.19-38.84-25.5-47.84-.21-108.43,51.09-125.1,18.58-5.94,38.94-5.47,57.46.3,18.38,5.72,36.07,15.96,47.34,31.94,8.52,12.76,12.22,28.9,12.47,44.09-.01,3.86-.29,7.76-1.19,11.61l-3.7-.83h0Z',
  'M73.3,186.68c-2.73,15.8,2.88,38.47,12.16,51.46,19.1,25.1,57.31,36.29,87.66,30.21,35.33-6.59,63.29-39.4,64.61-75.24.96-20.81-5.88-43.08-21.82-57.06-10.69-9.39-24.33-14.45-38.18-17.7-30.29-6.8-64.82-7.98-88.08-31.6-1.07-1.06-2.04-2.25-3.06-3.35,0,0-.5-.56-.5-.56l-.13-.14c.06.09-.5-.62-.65-.96-.49-.9-.72-2-.65-3.02.24-4.08,4.89-6.51,8.31-4.41,3.45,1.79,7.2,3.51,10.87,4.81,35.26,12.57,73.09,3.21,109.6,4.53,15.34.53,31.01,2.91,45.19,9.22,15.03,6.74,28.59,17.47,37.22,31.62,3.57,5.72,6.16,12.13,7.9,18.63,0,0-3.85,1.13-3.85,1.13-2.33-6.87-5.82-13.26-10.18-18.95-13.2-17.16-33.62-27.61-54.84-30.78-28.67-4.57-59.73,1.46-88.75,1.18-19.76-.1-40.18-3.18-57.84-12.67,2.98,1.59,7.85-1.53,5.73-5.97-.09-.24-.59-.85-.45-.68.31.34,1.08,1.2,1.4,1.56,21.46,23.75,55.8,23.97,85.01,31.11,17.92,4.23,36.19,12.01,48.39,26.49,13.59,15.84,19.25,37.6,18.01,58.03-1.25,23.61-12.7,46.04-30.32,61.58-30.11,27.07-74.23,27.8-108.74,8.77-20.52-11.45-32.27-26.21-37.04-49.34-1.9-9.45-2.9-19.17-.9-28.73,0,0,3.92.84,3.92.84h0Z',
]

/**
 * The front plate's print below the window, on a transparent texture the
 * plate's light falls on: the seat's QR, and the Sunbnb mark + wordmark at the
 * bottom. Covers model y 118–218 of 236 (x centred), so the QR's top lands at 124.
 */
function makePrintTexture() {
  const size = 256
  const k = size / 100 // texture px per model unit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  // QR: 58 units square, its top 6 units into the print (model y 124 of 236)
  drawQr(ctx, (size - 58 * k) / 2, 6 * k, 58 * k)
  // mark + wordmark on one line near the bottom (model y ≈ 207)
  const markH = 15 * k
  const markW = (markH * 303.75) / 277
  ctx.font = `600 ${14 * k}px system-ui, -apple-system, sans-serif`
  const word = 'sunbnb'
  const gap = 5 * k
  const total = markW + gap + ctx.measureText(word).width
  const x = (size - total) / 2
  const y = 88 * k
  ctx.save()
  ctx.translate(x, y - markH / 2)
  ctx.scale(markH / 277, markH / 277)
  ctx.fillStyle = '#1f2933'
  LOGO_PATHS.forEach((d) => ctx.fill(new Path2D(d)))
  ctx.restore()
  ctx.fillStyle = '#1f2933'
  ctx.textBaseline = 'middle'
  ctx.fillText(word, x + markW + gap, y)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** One pole's device; turns its wheel when the status changes (the shorter way round). */
function Device({ spec, parts, progress, reduced }: { spec: UnitSpec; parts: Parts; progress: MutableRefObject<number>; reduced: boolean }) {
  const wheel = useRef<THREE.Mesh>(null)
  const state = useRef({ status: deviceStatus(spec, progress.current), target: 0, angle: 0, primed: false })
  useFrame((_, dt) => {
    const st = state.current
    const status = deviceStatus(spec, progress.current)
    if (!st.primed) {
      st.target = st.angle = (WHEEL_ORDER.indexOf(status) * 2 * Math.PI) / 3
      st.status = status
      st.primed = true
    } else if (status !== st.status) {
      // a third forward, or a third back when scrolling up — never the long way round
      const d = (WHEEL_ORDER.indexOf(status) - WHEEL_ORDER.indexOf(st.status) + 3) % 3
      st.target += ((d === 1 ? 1 : -1) * 2 * Math.PI) / 3
      st.status = status
    }
    st.angle = reduced ? st.target : THREE.MathUtils.damp(st.angle, st.target, 5, dt)
    if (wheel.current) wheel.current.rotation.z = st.angle
  })
  const { geo, mat } = parts
  return (
    <group position={[0, 0, DEV_OFFSET]}>
      <mesh geometry={geo.deviceBody} material={mat.device} castShadow receiveShadow />
      <mesh geometry={geo.deviceSolar} material={mat.solar} />
      <mesh ref={wheel} geometry={geo.deviceWheel} material={mat.wheel} position={[0, DEV_HUB_Y, DEV_D / 2 - DEV_PLATE / 2]} />
      <mesh geometry={geo.devicePrint} material={mat.print} position={[0, DEV_H / 2 - 168 * DS, DEV_D / 2 + 0.0006]} />
    </group>
  )
}

// ── One parasol with its pair of loungers ───────────────────────────────────
function Unit({
  spec,
  parts,
  progress,
  lit,
  claimStart,
  reduced,
  onHover,
}: {
  spec: UnitSpec
  parts: Parts
  progress: MutableRefObject<number>
  lit: boolean
  claimStart: number | null
  reduced: boolean
  onHover: (id: number | null) => void
}) {
  const ring = useRef<THREE.Mesh>(null)
  const canopy = useRef<THREE.Group>(null)
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    [],
  )

  useFrame(({ clock }) => {
    const p = progress.current
    const t = clock.getElapsedTime()
    // dusk: the parasols fold
    if (canopy.current) {
      const d = THREE.MathUtils.smoothstep(p, 0.86, 0.97)
      canopy.current.scale.set(1 - 0.78 * d, 1 + 1.9 * d, 1 - 0.78 * d)
      canopy.current.position.y = 2.3 + 0.55 * d
    }
    if (!ring.current || spec.taken) return
    // the free-bed rings belong to the wide, map-like views only
    const wide = 1 - THREE.MathUtils.smoothstep(p, 0.3, 0.36)
    let opacity = (0.22 + Math.sin(t * 1.6 + spec.id) * 0.06) * wide
    let scale = 1
    if (lit) opacity = 0.85 * wide
    if (claimStart !== null) {
      const k = (t - claimStart) / 1.1
      if (k >= 0 && k <= 1) {
        const e = 1 - Math.pow(1 - k, 3)
        scale = 1 + e * 0.5
        opacity = Math.max(opacity, 0.9 * (1 - e))
      }
    }
    ringMat.opacity = opacity
    ring.current.scale.setScalar(scale)
  })

  const { geo, mat } = parts

  return (
    <group position={[spec.x, 0, spec.z]}>
      {[-0.42, 0.42].map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh geometry={geo.frame} material={mat.frame} position={[0, 0.16, 0]} castShadow receiveShadow />
          <mesh geometry={geo.cushion} material={mat.cushion} position={[0, 0.27, -0.14]} castShadow receiveShadow />
          <mesh
            geometry={geo.backrest}
            material={mat.cushion}
            position={[0, 0.5, 0.78]}
            rotation={[-0.95, 0, 0]}
            castShadow
            receiveShadow
          />
          {spec.taken && (
            <mesh
              geometry={geo.towel}
              material={mat.towel}
              position={[0, 0.355, -0.22]}
              rotation={[0, (spec.id % 3) * 0.04 - 0.04, 0]}
              castShadow
            />
          )}
        </group>
      ))}

      {/* pole between the beds at the head end; the status device faces the walkway, where a guest walks in; its sea side is blank */}
      <mesh geometry={geo.pole} material={mat.pole} position={[0, 1.15, POLE_Z]} castShadow />
      <group position={[0, 1.32, POLE_Z]} rotation={[0, spec.x < 0 ? 0.6 : -0.6, 0]}>
        <Device spec={spec} parts={parts} progress={progress} reduced={reduced} />
      </group>
      <group ref={canopy} position={[0, 2.3, POLE_Z]}>
        <mesh geometry={geo.canopy} material={mat.canopy} castShadow />
        <mesh geometry={geo.canopyRim} material={mat.canopyRim} position={[0, -0.25, 0]} />
      </group>

      {!spec.taken && (
        <mesh ref={ring} geometry={geo.ring} material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
      )}

      {!spec.taken && (
        <mesh
          geometry={geo.hit}
          material={mat.hit}
          position={[0, 1.1, 0]}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(spec.id)
          }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation()
            onHover(spec.id)
          }}
        />
      )}
    </group>
  )
}

// ── Golden hour: a tray of drinks on the claimed unit's table ───────────────
function Drinks({ parts, progress }: { parts: Parts; progress: MutableRefObject<number> }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!g.current) return
    const p = progress.current
    const s = THREE.MathUtils.smoothstep(p, 0.56, 0.64) * (1 - THREE.MathUtils.smoothstep(p, 0.95, 0.99))
    g.current.scale.setScalar(Math.max(0.0001, s))
    g.current.visible = s > 0.001
  })
  const mats = useMemo(
    () => ({
      tray: new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.5, metalness: 0.2 }),
      juice: new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.3 }),
      colada: new THREE.MeshStandardMaterial({ color: '#fbf3e0', roughness: 0.4 }),
      straw: new THREE.MeshStandardMaterial({ color: '#17323a', roughness: 0.6 }),
      slice: new THREE.MeshStandardMaterial({ color: '#fb923c', roughness: 0.7, side: THREE.DoubleSide }),
    }),
    [],
  )
  const { geo, mat } = parts
  return (
    <group position={[TABLE.x, 0, TABLE.z]}>
      <mesh geometry={geo.table} material={mat.wood} position={[0, 0.21, 0]} castShadow receiveShadow />
      <group ref={g} position={[0, 0.42, 0]}>
        <mesh material={mats.tray} position={[0, 0.012, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.024, 24]} />
        </mesh>
        <mesh material={mats.juice} position={[-0.09, 0.14, 0.02]} castShadow>
          <cylinderGeometry args={[0.055, 0.045, 0.24, 16]} />
        </mesh>
        <mesh material={mats.slice} position={[-0.09, 0.27, 0.02]} rotation={[0, 0.3, 0]}>
          <circleGeometry args={[0.055, 16]} />
        </mesh>
        <mesh material={mats.colada} position={[0.09, 0.15, -0.03]} castShadow>
          <cylinderGeometry args={[0.065, 0.04, 0.26, 16]} />
        </mesh>
        <mesh material={mats.straw} position={[0.12, 0.3, -0.03]} rotation={[0, 0, -0.25]}>
          <cylinderGeometry args={[0.006, 0.006, 0.3, 6]} />
        </mesh>
      </group>
    </group>
  )
}

// ── Dusk: string lights along the boardwalk ─────────────────────────────────
function StringLights({ progress }: { progress: MutableRefObject<number> }) {
  const bulbMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: BULB, emissive: BULB, emissiveIntensity: 0, roughness: 0.4 }),
    [],
  )
  // two halos per bulb: a tight bright core and a wide faint spill, both additive
  const haloMat = useMemo(
    () => new THREE.SpriteMaterial({ map: makeDiscTexture(GLOW_STOPS), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    [],
  )
  const spillMat = useMemo(
    () => new THREE.SpriteMaterial({ map: makeDiscTexture(GLOW_STOPS), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    [],
  )
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const p = progress.current
    const on = THREE.MathUtils.smoothstep(p, 0.84, 0.95)
    bulbMat.emissiveIntensity = on * 2.2
    haloMat.opacity = on * 0.9
    spillMat.opacity = on * 0.28
    for (const l of lights.current) if (l) l.intensity = on * 7
    if (group.current) {
      // the poles rise out of the sand toward evening; in the map view they were just sticks
      const up = THREE.MathUtils.smoothstep(p, 0.74, 0.84)
      group.current.visible = up > 0.001
      group.current.scale.set(1, Math.max(0.001, up), 1)
    }
  })
  const bulbs = useMemo(() => {
    const out: [number, number, number][] = []
    for (let i = 0; i < 6; i++) {
      const z = SHORE_Z + 4 + i * 3.6
      out.push([-(WALK_W / 2 + 0.25), 2.55, z], [WALK_W / 2 + 0.25, 2.55, z])
    }
    return out
  }, [])
  return (
    <group ref={group}>
      {bulbs.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh position={[0, -1.3, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.03, 2.6, 6]} />
            <meshStandardMaterial color={POLE} roughness={0.8} />
          </mesh>
          <mesh material={bulbMat}>
            <sphereGeometry args={[0.09, 12, 12]} />
          </mesh>
          <sprite material={haloMat} scale={[1.1, 1.1, 1]} />
          <sprite material={spillMat} scale={[3.6, 3.6, 1]} />
          {i % 2 === 0 && (
            <pointLight
              ref={(el) => {
                lights.current[i] = el
              }}
              color={BULB}
              intensity={0}
              distance={9}
              decay={2}
            />
          )}
        </group>
      ))}
    </group>
  )
}

// ── Sky furniture: a sun disc for the low hours, stars for dusk ─────────────
/** A soft radial disc — the sun, and the glow around each bulb. A sprite with no map is a hard square. */
function makeDiscTexture(stops: [number, string][]) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, color] of stops) g.addColorStop(at, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
const SUN_STOPS: [number, string][] = [
  [0, 'rgba(255,240,210,1)'],
  [0.35, 'rgba(255,200,130,0.95)'],
  [0.6, 'rgba(255,170,100,0.35)'],
  [1, 'rgba(255,150,90,0)'],
]
const GLOW_STOPS: [number, string][] = [
  [0, 'rgba(255,236,190,1)'],
  [0.18, 'rgba(255,214,130,0.75)'],
  [0.45, 'rgba(255,190,100,0.22)'],
  [1, 'rgba(255,170,80,0)'],
]

function SkyFurniture({ progress }: { progress: MutableRefObject<number> }) {
  const sunMat = useMemo(
    () => new THREE.SpriteMaterial({ map: makeDiscTexture(SUN_STOPS), transparent: true, opacity: 0, depthWrite: false, fog: false }),
    [],
  )
  const sun = useRef<THREE.Sprite>(null)
  const stars = useRef<THREE.Points>(null)
  const starMat = useMemo(
    () => new THREE.PointsMaterial({ color: '#fff6e0', size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    [],
  )
  const starGeo = useMemo(() => {
    const n = 220
    const arr = new Float32Array(n * 3)
    let seed = 11
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2
      const r = 60 + rnd() * 60
      arr[i * 3] = Math.cos(a) * r
      arr[i * 3 + 1] = 14 + rnd() * 45
      arr[i * 3 + 2] = Math.sin(a) * r - 30
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  const tmp = useMemo(() => [0, 0, 0, 0], [])
  useFrame(() => {
    const p = progress.current
    if (sun.current) {
      // over the water, left of centre, sinking toward the horizon as the day ends
      const sink = THREE.MathUtils.smoothstep(p, 0.74, 0.96)
      sun.current.position.set(-18, 9.5 - 7 * sink, -75)
      const low = THREE.MathUtils.smoothstep(p, 0.58, 0.74) * (1 - THREE.MathUtils.smoothstep(p, 0.9, 0.98))
      sunMat.opacity = low
      const s = 16 + 10 * THREE.MathUtils.smoothstep(p, 0.74, 0.95)
      sun.current.scale.set(s, s, 1)
    }
    starMat.opacity = THREE.MathUtils.smoothstep(p, 0.9, 1)
    if (stars.current) stars.current.visible = p > 0.88
  })
  return (
    <>
      <sprite ref={sun} material={sunMat} />
      <points ref={stars} geometry={starGeo} material={starMat} />
    </>
  )
}

// ── Water: swell + shore foam, colours and haze driven by time of day ───────
const seaVertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w1 = sin(p.x * 0.35 + uTime * 0.9) * 0.09;
    float w2 = sin(p.y * 0.55 - uTime * 1.25) * 0.07;
    float w3 = sin((p.x + p.y) * 0.22 + uTime * 0.6) * 0.05;
    p.z += w1 + w2 + w3;
    vHeight = w1 + w2 + w3;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const seaFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uSky;
  uniform float uGlint;
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vWorld;
  void main() {
    float depth = smoothstep(0.0, 0.55, vUv.y);
    vec3 col = mix(uShallow, uDeep, depth);
    col += vec3(0.08) * smoothstep(0.05, 0.2, vHeight);
    // low sun: a glint path across the water toward the west
    float path = exp(-pow((vWorld.x + 26.0 - vUv.y * 20.0) * 0.08, 2.0));
    col += uGlint * path * smoothstep(0.1, 0.9, vUv.y) * vec3(1.0, 0.72, 0.45) * (0.6 + 0.4 * smoothstep(0.0, 0.15, vHeight));
    float shoreBand = 1.0 - smoothstep(0.0, 0.07 + 0.02 * sin(uTime * 0.8 + vWorld.x * 0.3), vUv.y);
    float lace = 0.5 + 0.5 * sin(vWorld.x * 2.1 + uTime * 1.4) * sin(vWorld.x * 0.7 - uTime * 0.9);
    col = mix(col, uFoam, shoreBand * (0.55 + 0.45 * lace));
    col = mix(col, uSky, smoothstep(0.45, 1.0, vUv.y));
    gl_FragColor = vec4(col, 1.0);
  }
`

function Sea({ progress }: { progress: MutableRefObject<number> }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uFoam: { value: new THREE.Color(FOAM) },
      uSky: { value: new THREE.Color() },
      uGlint: { value: 0 },
    }),
    [],
  )
  const tmp = useMemo(() => [0, 0, 0], [])
  useFrame(({ clock }) => {
    if (!mat.current) return
    const p = progress.current
    const u = mat.current.uniforms
    u.uTime!.value = clock.getElapsedTime()
    lerpKeys(SEA_DEEP, p, tmp)
    ;(u.uDeep!.value as THREE.Color).setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
    lerpKeys(SEA_SHALLOW, p, tmp)
    ;(u.uShallow!.value as THREE.Color).setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
    lerpKeys(SKY, p, tmp)
    ;(u.uSky!.value as THREE.Color).setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
    u.uGlint!.value = THREE.MathUtils.smoothstep(p, 0.6, 0.8) * (1 - THREE.MathUtils.smoothstep(p, 0.9, 1))
    const foam = 1 - THREE.MathUtils.smoothstep(p, 0.85, 1) * 0.6
    ;(u.uFoam!.value as THREE.Color).setRGB(foam, foam, foam)
  })
  const DEPTH = 80
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, SHORE_Z - DEPTH / 2]}>
      <planeGeometry args={[200, DEPTH, 96, 48]} />
      <shaderMaterial ref={mat} vertexShader={seaVertex} fragmentShader={seaFragment} uniforms={uniforms} />
    </mesh>
  )
}

// ── Ground: sand to the shoreline, the damp strip, the boardwalk ────────────
function Ground({ progress }: { progress: MutableRefObject<number> }) {
  const sand = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f6e7c5', roughness: 1 }), [])
  const wet = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#dcc394', roughness: 1, transparent: true, opacity: 0.75 }),
    [],
  )
  const tmp = useMemo(() => [0, 0, 0], [])
  useFrame(() => {
    const p = progress.current
    lerpKeys(SAND, p, tmp)
    sand.color.setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
    lerpKeys(SAND_WET, p, tmp)
    wet.color.setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
  })
  const slats = useMemo(() => {
    const count = 64
    const m = new THREE.Matrix4()
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(WALK_W - 0.2, 0.06, 0.26),
      new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 }),
      count,
    )
    for (let i = 0; i < count; i++) {
      m.makeTranslation(0, 0.03, SHORE_Z + 0.3 + i * 0.36)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, SHORE_Z + 50]} material={sand} receiveShadow>
        <planeGeometry args={[240, 100]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, SHORE_Z + 0.9]} material={wet} receiveShadow>
        <planeGeometry args={[240, 1.8]} />
      </mesh>
      <primitive object={slats} />
    </group>
  )
}

// ── Sun, sky, camera ────────────────────────────────────────────────────────
function Atmosphere({ progress }: { progress: MutableRefObject<number> }) {
  const { scene } = useThree()
  const sun = useRef<THREE.DirectionalLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const tmp = useMemo(() => [0, 0, 0, 0], [])
  const bg = useMemo(() => new THREE.Color('#f8efdc'), [])
  const fog = useMemo(() => new THREE.Fog('#f8efdc', 34, 85), [])
  useEffect(() => {
    scene.background = bg
    scene.fog = fog
    return () => {
      scene.background = null
      scene.fog = null
    }
  }, [scene, bg, fog])

  useFrame(() => {
    const p = progress.current
    lerpKeys(SKY, p, tmp)
    bg.setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
    fog.color.copy(bg)
    if (sun.current) {
      lerpKeys(SUN, p, tmp)
      sun.current.position.set(tmp[0]!, tmp[1]!, tmp[2]!)
      sun.current.intensity = tmp[3]!
      lerpKeys(SUN_COLOR, p, tmp)
      sun.current.color.setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
    }
    if (ambient.current) ambient.current.intensity = lerpKeys(AMBIENT, p, tmp)[0]!
    if (hemi.current) {
      lerpKeys(HEMI_SKY, p, tmp)
      hemi.current.color.setRGB(tmp[0]!, tmp[1]!, tmp[2]!)
      hemi.current.intensity = 0.75 - 0.4 * THREE.MathUtils.smoothstep(p, 0.85, 1)
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={['#eaf7fb', '#f6e7c5', 0.75]} />
      <ambientLight ref={ambient} intensity={0.5} />
      <directionalLight
        ref={sun}
        position={[10, 22, 10]}
        intensity={2.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={2}
        shadow-camera-far={70}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
    </>
  )
}

function Rig({ progress, reduced }: { progress: MutableRefObject<number>; reduced: boolean }) {
  const { camera, size } = useThree()
  const smooth = useRef(0)
  const pos = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const centre = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }, dt) => {
    // ease toward the scroll position so a flick reads as a camera move
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 6)
    smooth.current += (progress.current - smooth.current) * k
    const p = THREE.MathUtils.clamp(smooth.current, 0, 1)

    const t = tOfP(p)
    posCurve.getPoint(t, pos)
    lookCurve.getPoint(t, look)

    if (p > SPIRAL_IN && p < SPIRAL_OUT) {
      const u = THREE.MathUtils.smoothstep(p, SPIRAL_IN, SPIRAL_OUT)
      const phi = (THREE.MathUtils.lerp(165, 360, u) * Math.PI) / 180
      const r = THREE.MathUtils.lerp(1.3, 0, u)
      const h = THREE.MathUtils.lerp(1.0, 1.9, u)
      centre.lerpVectors(TABLE_C, WALK_C, u)
      pos.set(centre.x + Math.sin(phi) * r, h, centre.z + Math.cos(phi) * r)
      // the yaw keeps pointing "at the centre" along φ, so it turns continuously
      // from the table round to the sea; the look distance opens up as we arrive
      const d = THREE.MathUtils.lerp(1.3, 10, u)
      look.set(pos.x - Math.sin(phi) * d, THREE.MathUtils.lerp(tableLook.y, 0.8, u), pos.z - Math.cos(phi) * d)
    }

    // portrait viewports stand further back from the look target
    const aspect = size.width / Math.max(1, size.height)
    if (aspect < 1) {
      dir.subVectors(pos, look)
      pos.copy(look).addScaledVector(dir, 1 + (1 - aspect) * 0.9)
    }

    if (!reduced) {
      const t = clock.getElapsedTime()
      // less drift in the close-ups
      const calm = 1 - THREE.MathUtils.smoothstep(p, 0.3, 0.36) + THREE.MathUtils.smoothstep(p, SPIRAL_OUT, 1)
      pos.x += Math.sin(t * 0.18) * 0.5 * calm
      pos.y += Math.sin(t * 0.23) * 0.12 * calm
    }

    camera.position.copy(pos)
    camera.lookAt(look)
  })
  return null
}

// ── Scene ───────────────────────────────────────────────────────────────────
function Club({
  progress,
  reduced,
  yoursLabel,
}: {
  progress: MutableRefObject<number>
  reduced: boolean
  yoursLabel: string
}) {
  const parts = useParts()
  const [hovered, setHovered] = useState<number | null>(null)
  const [claimStart, setClaimStart] = useState<number | null>(null)
  const [claimed, setClaimed] = useState(false)
  const [tagOn, setTagOn] = useState(false)

  useFrame(({ clock }) => {
    const p = progress.current
    if (!claimed && p > 0.2) {
      setClaimStart(reduced ? null : clock.getElapsedTime())
      setClaimed(true)
    }
    // the tag belongs to the wide views; close-ups and dusk drop it
    const show = claimed && p < 0.34
    if (show !== tagOn) setTagOn(show)
  })

  const litId = hovered ?? (claimed ? CLAIMED_ID : null)
  const litUnit = litId !== null ? UNITS[litId] : null

  return (
    <>
      <Atmosphere progress={progress} />
      <Ground progress={progress} />
      <Sea progress={progress} />
      <SkyFurniture progress={progress} />
      <StringLights progress={progress} />
      <Drinks parts={parts} progress={progress} />

      {UNITS.map((u) => (
        <Unit
          key={u.id}
          spec={u}
          parts={parts}
          progress={progress}
          lit={litId === u.id}
          claimStart={u.id === CLAIMED_ID ? claimStart : null}
          reduced={reduced}
          onHover={setHovered}
        />
      ))}

      {litUnit && tagOn && (
        <Html position={[litUnit.x, 3.2, litUnit.z + POLE_Z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <span className="sb-scene-tag">{yoursLabel}</span>
        </Html>
      )}

      <Rig progress={progress} reduced={reduced} />
    </>
  )
}

// ── Public component ────────────────────────────────────────────────────────
export default function BeachScene({
  progress,
  active,
  yoursLabel,
  label,
}: {
  /** Scroll progress of the stage, 0..1, written by the parent every frame. */
  progress: MutableRefObject<number>
  /** False while the stage is scrolled away — rendering pauses. */
  active: boolean
  /** The pill on the claimed / hovered bed, e.g. "Yours". */
  yoursLabel: string
  /** Describes the picture for assistive tech. */
  label: string
}) {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <div className="sb-scene absolute inset-0" role="img" aria-label={label}>
      <style>{`
        .sb-scene-tag {
          display: inline-block;
          padding: 4px 11px;
          border-radius: 999px;
          background: #046b7d;
          color: #fffdf7;
          font: 600 12px/1.4 var(--font-geist-sans), system-ui, sans-serif;
          letter-spacing: 0.01em;
          box-shadow: 0 2px 10px rgba(4, 107, 125, 0.25);
          white-space: nowrap;
        }
      `}</style>
      <Canvas
        flat
        shadows
        dpr={[1, 1.75]}
        frameloop={active ? 'always' : 'never'}
        camera={{ fov: 40, near: 0.3, far: 180, position: [0, 36, 4.5] }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        style={{ touchAction: 'pan-y' }}
      >
        <Club progress={progress} reduced={reduced} yoursLabel={yoursLabel} />
      </Canvas>
    </div>
  )
}
