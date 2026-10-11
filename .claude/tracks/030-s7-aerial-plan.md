# Track 030 · S7 design — aerial/drone photo → map parcels (Plan agent, 2026-10-11)

Reuses the `inventory_batch` kind (`create_parcel` ops → ChairConfig → generateChairs → syncChairsWithLayout), so preview/apply/undo are unchanged. Model returns pixel-space intent; deterministic fit makes geometry.

## Georef (MVP)
- **Manual overlay alignment on InventoryMap** (custom `OverlayView` + CSS matrix; drag/rotate-scale handle/opacity; optional 2-point pin). Human alignment = manual placement, no Google pixels in any automated step.
- **Seed** from DJI XMP (`drone-dji:Gps*/RelativeAltitude/GimbalYaw/Pitch`, nadir ±10°) + EXIF FOV (`exifr`); else site centre + **bed-size scale** (bed ≈ 2.1 m).
- Reference layers: existing parcels + OSM shoreline (open data). Satellite toggle during alignment: OFF — founder/legal call (D9, 027 D8).
- `Georef` tagged union `similarity` (MVP) | `homography` (v2) in `packages/agent/src/geo/georef.ts` (`pxToEnu`, `latLngToPx`, `similarityFrom2Points`, `similarityFromDji`, `cssMatrixFor`).
- v2: 4-corner homography (oblique), coastline orientation snap, unaligned shore-relative fit.

## Vision descriptor (Opus 5.5, structured output, effort high, image resized to 2000 px long edge)
`AerialDescriptorV1 { image{w,h}, view nadir|oblique|unclear, usable, bed{lengthPx,widthPx}, shoreline{points,seaSide}, parcels[{id, rows[{first,last,units,paired,occludedBeds,confidence}] front→back, facing, confidence}], ignored[] }` — row endpoints + unit counts, not per-bed points.

## Fit (`packages/agent/src/geo/grid-fit.ts`, pure)
Rows → ENU via georef; seat dir = mean row vector; pitch from endpoints/count; split uneven rows into rectangular sub-parcels; choose corner so row axis = seat axis rotated 90° CCW (grid.ts convention: anchor = R01C01, seat axis (cosθ,−sinθ), row axis (sinθ,cosθ)); gaps from pitch (paired: pitch−2W−0.4; single: pitch−W; vGap = rowPitch−2.1); clamp + warn; ≤99 rows/seats; facing → `reverse` ops (**confirm head/feet glyph convention first**). Confidence = parcel × rows × fit quality.
Partner plan (`lib/assistant/aerial/plan.ts`): parcel numbers from max+1, drop < min_confidence (0.4), land check (signedShoreDistance), overlap warnings, split >1200 seats.

## Flow
`request_photo_alignment(upload_id)` → SSE `align_photo {uploadId, seed}` → align UI; extraction starts in parallel via `POST /api/assistant/aerial/[uploadId]/extract` (maxDuration 300, CAS status, descriptor cached on upload); confirm saves georef + canned message → `propose_layout_from_photo(upload_id)` fits in ms.

## Geo move
`git mv` marketing `lib/{coastline,beach-layout,land-fit}.ts` → `packages/agent/src/geo/`, marketing one-line re-export shims (272 tests unmodified). `overpass.ts` → `packages/data/src/coastline-overpass.ts` + `coastline-lookup.ts shoreAround()`; partner needs `COASTLINE_POSTGRES_URL`. `projection.ts` is revenue (not geo), `inland-water.ts` stays.

## Limits / cost / eval
Extraction counts against `allowExtractionJob` (10/day) only on a real Opus call; aerial sub-cap 3/day. ≈ $0.2–0.45/photo. Eval `packages/agent/eval/vision/` shared with 027 P11 (licensed/consented images only, never Google tiles); deterministic round-trip property test ChairConfig → beds → px → descriptor → fit.

## Packets
S7a geo move ∥ S7b georef/fit/descriptor core (pure) → S7c server data+extract (migration: `assistant_upload.georef`, `.aerial` jsonb) ∥ S7d alignment UI → S7e browser verify + eval + docs. S7f = v2.

## Risks
Miscounts (dense/occluded), oblique phone photos (refuse in MVP), head/feet convention, 60 s chat limit (separate route), licensing, >1200 seats, missing COASTLINE_POSTGRES_URL (warn).
