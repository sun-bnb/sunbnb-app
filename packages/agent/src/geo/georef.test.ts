import { describe, expect, it } from 'vitest'
import {
  METERS_PER_DEG_LAT,
  affineFrom3Points,
  cssMatrixFor,
  enuToPx,
  hfovFromFocal35,
  latLngToPx,
  parseDjiXmp,
  pxToEnu,
  pxToLatLng,
  similarityFrom2Points,
  similarityFromBedSize,
  similarityFromDji,
  type Georef,
  type SimilarityGeoref,
} from './georef.ts'

const ANCHOR = { lat: 36.7215, lng: -4.4217 } // Málaga
const sim = (rotationDeg: number, metersPerPx = 0.05): SimilarityGeoref => ({
  kind: 'similarity',
  anchorPx: { x: 1000, y: 750 },
  anchor: ANCHOR,
  metersPerPx,
  rotationDeg,
})

describe('similarity georef', () => {
  it('north-up: right = east, down = south, scale applied', () => {
    const g = sim(0)
    const right = pxToEnu(g, { x: 1100, y: 750 })
    expect(right.e).toBeCloseTo(5, 12)
    expect(right.n).toBeCloseTo(0, 12)
    const down = pxToEnu(g, { x: 1000, y: 850 })
    expect(down.e).toBeCloseTo(0, 12)
    expect(down.n).toBeCloseTo(-5, 12)
  })

  it('image top pointing east (90°): image up = east, image right = south', () => {
    const g = sim(90)
    const up = pxToEnu(g, { x: 1000, y: 650 })
    expect(up.e).toBeCloseTo(5, 12)
    expect(up.n).toBeCloseTo(0, 12)
    const right = pxToEnu(g, { x: 1100, y: 750 })
    expect(right.e).toBeCloseTo(0, 12)
    expect(right.n).toBeCloseTo(-5, 12)
  })

  it('px -> ENU -> px and px -> lat/lng -> px round-trip exactly at any rotation', () => {
    for (const rot of [0, 17.3, 90, 181, 359.9]) {
      const g = sim(rot, 0.0371)
      for (const p of [{ x: 0, y: 0 }, { x: 1999, y: 1499 }, { x: 123.4, y: 987.6 }]) {
        const back = enuToPx(g, pxToEnu(g, p))
        expect(back.x).toBeCloseTo(p.x, 9)
        expect(back.y).toBeCloseTo(p.y, 9)
        const back2 = latLngToPx(g, pxToLatLng(g, p))
        expect(back2.x).toBeCloseTo(p.x, 7)
        expect(back2.y).toBeCloseTo(p.y, 7)
      }
    }
  })

  it('uses the 111 320 m/deg equirectangular constants of chair-util / schematic', () => {
    const g = sim(0, 1)
    const ll = pxToLatLng(g, { x: 1000, y: 750 - 111.32 }) // 111.32 m north
    expect(ll.lat - ANCHOR.lat).toBeCloseTo(111.32 / METERS_PER_DEG_LAT, 12)
    const ll2 = pxToLatLng(g, { x: 1100, y: 750 }) // 100 m east
    expect(ll2.lng - ANCHOR.lng).toBeCloseTo(100 / (111320 * Math.cos((ANCHOR.lat * Math.PI) / 180)), 12)
  })
})

describe('homography georef (reserved)', () => {
  it('a homography equal to a similarity behaves the same and round-trips', () => {
    const s = sim(30, 0.05)
    const r = (30 * Math.PI) / 180
    const k = 0.05
    // e = k(cos r·(x−ax) − sin r·(y−ay)), n = k(−sin r·(x−ax) − cos r·(y−ay))
    const h: Georef = {
      kind: 'homography',
      anchor: ANCHOR,
      h: [k * Math.cos(r), -k * Math.sin(r), -k * (Math.cos(r) * 1000 - Math.sin(r) * 750), -k * Math.sin(r), -k * Math.cos(r), k * (Math.sin(r) * 1000 + Math.cos(r) * 750), 0, 0, 1],
    }
    const p = { x: 321, y: 1234 }
    expect(pxToEnu(h, p).e).toBeCloseTo(pxToEnu(s, p).e, 9)
    expect(pxToEnu(h, p).n).toBeCloseTo(pxToEnu(s, p).n, 9)
    const back = latLngToPx(h, pxToLatLng(h, p))
    expect(back.x).toBeCloseTo(p.x, 7)
    expect(back.y).toBeCloseTo(p.y, 7)
  })
})

describe('similarityFrom2Points', () => {
  it('recovers a known similarity exactly from two of its points', () => {
    for (const rot of [0, 45, 133.7, 270, 359]) {
      const truth = sim(rot, 0.042)
      const a = { x: 210, y: 1300 }
      const b = { x: 1780, y: 160 }
      const g = similarityFrom2Points({ px: a, ll: pxToLatLng(truth, a) }, { px: b, ll: pxToLatLng(truth, b) })
      // Exact on the pins; elsewhere only the equirectangular anchor choice differs (cos(lat) of a
      // different anchor), which is sub-millimetre over a beach.
      for (const p of [a, b]) {
        const q = latLngToPx(g, pxToLatLng(truth, p))
        expect(q.x).toBeCloseTo(p.x, 6)
        expect(q.y).toBeCloseTo(p.y, 6)
      }
      expect(g.metersPerPx / 0.042).toBeCloseTo(1, 5)
      expect(Math.abs(((g.rotationDeg - rot + 540) % 360) - 180)).toBeLessThan(1e-3)
      const q = latLngToPx(g, pxToLatLng(truth, { x: 5, y: 5 }))
      expect(Math.hypot(q.x - 5, q.y - 5) * 0.042).toBeLessThan(0.001)
    }
  })

  it('rejects coincident pins', () => {
    expect(() => similarityFrom2Points({ px: { x: 1, y: 1 }, ll: ANCHOR }, { px: { x: 1, y: 1 }, ll: { lat: 36.73, lng: -4.42 } })).toThrow()
  })
})

// A trimmed real-world DJI Mavic 3 XMP packet (attribute form).
const DJI_ATTR = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>
 <rdf:Description rdf:about="DJI Meta Data" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
   drone-dji:GpsLatitude="+36.72150123"
   drone-dji:GpsLongitude="-4.42170456"
   drone-dji:AbsoluteAltitude="+92.345"
   drone-dji:RelativeAltitude="+60.100"
   drone-dji:GimbalRollDegree="+0.00"
   drone-dji:GimbalYawDegree="-35.20"
   drone-dji:GimbalPitchDegree="-89.90"
   drone-dji:FlightYawDegree="-34.80"/></rdf:RDF></x:xmpmeta>`

// Element form + the old `GpsLongtitude` misspelling, oblique gimbal.
const DJI_ELEM_OBLIQUE = `<rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">
 <drone-dji:GpsLatitude>36.5</drone-dji:GpsLatitude>
 <drone-dji:GpsLongtitude>-4.6</drone-dji:GpsLongtitude>
 <drone-dji:RelativeAltitude>35.0</drone-dji:RelativeAltitude>
 <drone-dji:GimbalYawDegree>120.5</drone-dji:GimbalYawDegree>
 <drone-dji:GimbalPitchDegree>-45.0</drone-dji:GimbalPitchDegree>
</rdf:Description>`

describe('parseDjiXmp', () => {
  it('reads the attribute form', () => {
    expect(parseDjiXmp(DJI_ATTR)).toEqual({ lat: 36.72150123, lng: -4.42170456, relAltM: 60.1, yawDeg: -35.2, pitchDeg: -89.9, nadir: true })
  })

  it('reads the element form and the GpsLongtitude typo; flags oblique pitch', () => {
    expect(parseDjiXmp(DJI_ELEM_OBLIQUE)).toEqual({ lat: 36.5, lng: -4.6, relAltM: 35, yawDeg: 120.5, pitchDeg: -45, nadir: false })
  })

  it('nadir window is −90 ± 10°', () => {
    const at = (p: string) => parseDjiXmp(DJI_ATTR.replace('-89.90', p))!.nadir
    expect(at('-80.0')).toBe(true)
    expect(at('-100.0')).toBe(true)
    expect(at('-79.5')).toBe(false)
  })

  it('null when a required field is missing or there is no DJI block', () => {
    expect(parseDjiXmp(DJI_ATTR.replace(/drone-dji:RelativeAltitude="[^"]*"/, ''))).toBeNull()
    expect(parseDjiXmp('<x:xmpmeta/>')).toBeNull()
  })
})

describe('similarityFromDji', () => {
  const image = { w: 4000, h: 3000 }
  it('centre = drone position, width from altitude × FOV, up = gimbal yaw', () => {
    const xmp = parseDjiXmp(DJI_ATTR)!
    const g = similarityFromDji({ ...xmp, hfovDeg: 73.7 }, image)!
    expect(g.anchor).toEqual({ lat: 36.72150123, lng: -4.42170456 })
    expect(g.anchorPx).toEqual({ x: 2000, y: 1500 })
    const groundW = 2 * 60.1 * Math.tan((73.7 / 2) * (Math.PI / 180))
    expect(g.metersPerPx).toBeCloseTo(groundW / 4000, 12)
    expect(g.rotationDeg).toBeCloseTo(324.8, 9)
    // The top-centre pixel lies half the ground height away along bearing 324.8°.
    const top = pxToEnu(g, { x: 2000, y: 0 })
    const bearing = ((Math.atan2(top.e, top.n) * 180) / Math.PI + 360) % 360
    expect(bearing).toBeCloseTo(324.8, 6)
    expect(Math.hypot(top.e, top.n)).toBeCloseTo((groundW * 0.75) / 2, 6)
  })

  it('refuses oblique shots and nonsense', () => {
    const xmp = parseDjiXmp(DJI_ELEM_OBLIQUE)!
    expect(similarityFromDji({ ...xmp, hfovDeg: 70 }, image)).toBeNull()
    expect(similarityFromDji({ lat: 1, lng: 1, relAltM: 0, yawDeg: 0, pitchDeg: -90, hfovDeg: 70 }, image)).toBeNull()
  })

  it('hfovFromFocal35: 24 mm equivalent on 4:3 is ~71.6° horizontal', () => {
    expect(hfovFromFocal35(24, image)).toBeCloseTo(71.6, 0)
  })

  it('bed-size seed: 2.1 m over the bed length in px', () => {
    expect(similarityFromBedSize(ANCHOR, image, 42)!.metersPerPx).toBeCloseTo(0.05, 12)
    expect(similarityFromBedSize(ANCHOR, image, 0)).toBeNull()
  })
})

describe('cssMatrixFor', () => {
  it('affineFrom3Points is exact on its three points', () => {
    const m = affineFrom3Points(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }],
      [{ x: 3, y: 4 }, { x: 3, y: 14 }, { x: -2, y: 4 }],
    )
    expect(m).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 3, f: 4 })
  })

  it('composes georef with a linear map projection into one CSS matrix', () => {
    const g = sim(33, 0.05)
    // A fake north-up projection at 4 screen px per metre with an offset.
    const project = (ll: { lat: number; lng: number }) => ({
      x: 500 + (ll.lng - ANCHOR.lng) * 111320 * Math.cos((ANCHOR.lat * Math.PI) / 180) * 4,
      y: 300 - (ll.lat - ANCHOR.lat) * 111320 * 4,
    })
    const m = cssMatrixFor(g, { w: 2000, h: 1500 }, project)
    for (const p of [{ x: 1000, y: 750 }, { x: 1700, y: 200 }]) {
      const want = project(pxToLatLng(g, p))
      expect(m.a * p.x + m.c * p.y + m.e).toBeCloseTo(want.x, 6)
      expect(m.b * p.x + m.d * p.y + m.f).toBeCloseTo(want.y, 6)
    }
    // A similarity onto a north-up map is a pure rotation + scale (0.05 m/px × 4 px/m = 0.2).
    expect(Math.hypot(m.a, m.b)).toBeCloseTo(0.2, 9)
    expect(m.css.startsWith('matrix(')).toBe(true)
  })
})
