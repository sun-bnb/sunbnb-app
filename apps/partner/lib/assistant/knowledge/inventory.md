# Inventory map editor (geo layout mode)

Facts below come from the partner app code. Button names are the English UI labels.

## Overview {#inventory-overview}

The **Inventory** tab of a site (`/sites/<id>/inventory`) is where sunbeds are placed. In **map mode**
(layout mode "Map (Google Maps)") the editor is a satellite map: each sunbed is a marker. Sites in
**schematic mode** get a drawn canvas instead (see the schematic topics); the tab is still labelled
"Inventory".

The unit of work is the **parcel**: a block of sunbeds laid out in rows and seats-per-row, numbered
1, 2, 3, ... A parcel has its own colour, shown on the map and in the **Parcels** chip bar above the
toolbar (each chip shows the parcel number and its seat count). Sunbeds that belong to no parcel
("single items") are possible too.

Large sites load lazily: at overview zoom the map draws one box per parcel; zoom in or open a parcel
and its individual sunbeds load.

## Adding things {#adding}

- **+ Add Parcel**: click it, then click the map where the parcel should go. A side panel ("New Parcel")
  asks for Rows, Seats/row, the Pair seats toggle, gaps in metres, rotation, category, price and the group
  (parcel) number. The grid is generated at the click point.
- **+ Single item**: click it, then click the map to drop one sunbed. A hand-placed sunbed becomes a
  **pair** (a unit of two beds) by default.
- While placing, the toolbar shows "Click on the map to place ..." with a Cancel button. Escape also cancels.

## Selecting {#selecting}

- Click a sunbed to select it (single-sunbed bar). Click a parcel chip to select the whole parcel.
- Shift+drag draws a selection box; Cmd/Ctrl+click toggles sunbeds in or out of a multi-selection.
- When part of a parcel is selected the toolbar shows "n of N" and a **Select all** link.
- The blue selection bar shows what is possible for the current selection.

## Moving {#moving}

- Drag any sunbed of a parcel and the **whole parcel** moves with it (the server moves it to the
  dropped position, so quick successive drags do not drift).
- With a selection active you can also click the map to move the selection there ("Click map to move").
- Single, loose sunbeds are dragged individually. Paired beds travel together.

- **Ask the assistant for relative moves**: "move parcel 5 closer to parcel 4", "put parcel 2 next to
  parcel 3", "2 m from parcel 1". The assistant knows where every parcel sits (centre, size in metres,
  direction of the rows) and measures the gap between two parcels edge to edge, so you never need to give
  coordinates. It moves the parcel along the line between the two centres so the gap becomes what you
  asked for (2 m if you name none, 0 for "touching"), shows the result as a ghost preview and waits for
  Apply.
- **Ask the assistant to move toward or away from the sea**: "move parcels 4 and 5 closer to the sea",
  "5 m from the waterline". On a map site the assistant reads the real shoreline (OpenStreetMap) around
  the venue; on a schematic site it uses the Water shapes you drew. It measures from the parcel's nearest
  edge to the waterline, so you never need to say which way the sea is. If you give no distance it tells
  you the current distance and proposes the front edge 5 m from the waterline (never into the water).
  Several parcels moved together shift by one common amount, so the gaps between them stay as they are.
  If no shoreline can be found near the venue, the assistant asks you for the direction instead.
- **Ask the assistant spatial questions about the whole site**: "which parcel is nearest the bar", "is
  anything on the promenade", "how far is parcel 3 from the road", "line parcel 9 up with parcel 8". The
  assistant first takes a look at the site (your parcels, the drawn elements, the shoreline, and on a map
  site the surrounding roads, footpaths, promenade, buildings and amenities such as lifeguard towers and
  toilets from OpenStreetMap), then measures exactly between any two things and proposes the move as a
  ghost preview. OpenStreetMap is a public service and may be slow or incomplete: when it cannot be read
  the assistant says so, and what is not mapped there it cannot see.

## Rotate and spacing {#rotate-spacing}

Rotation is in degrees.
- **Selection bar** (a parcel or several sunbeds): rotate left/right in steps of 5 degrees. If the
  whole parcel is selected the grid is regenerated at the new angle around its centre; for a partial
  selection only the selected beds are rotated.
- **Single sunbed**: rotate left/right in steps of 15 degrees.
- **Spacing** (only with 2+ sunbeds selected): the H and V buttons shrink or grow horizontal or
  vertical spacing in 10 percent steps (x0.9 / x1.1).
- For an exact angle or exact gaps open the parcel panel (below) and type the Rotation (deg) and gaps.

## Editing a parcel {#parcel-edit}

Select the whole parcel and click the pencil (**Edit parcel config**). The panel offers:
- Rows and Seats/row. In edit mode you change the size by editing these values and clicking
  **Apply changes**; the editor keeps existing sunbeds where the new grid overlaps the old one and only
  adds or removes the difference.
- **Pair seats** toggle (groups seats in pairs) and the gaps: Between pairs (or Horizontal when not
  paired), Between rows, and Paired beds gap (only when paired).
- Rotation (deg), Category and Price (euros, VAT-inclusive listing price; the panel shows the price
  breakdown).
- **Apply changes**, **Reverse seat numbering** (numbers count from the other end of each row; beds
  stay where they are), **Reverse orientation** (turns every bed 180 degrees).
- **Visible / Hidden** switch: hides the whole parcel from customers without deleting it.
- **Delete parcel** (danger zone): removes all its sunbeds.
- The grid icon on a chip or in the selection bar (**Restore grid formation**) snaps a parcel back
  to a neat grid after loose edits.

Shrinking a parcel is refused if a removed spot has a booking or a device on it.

## Single sunbed panel {#seat-edit}

Select one sunbed and click the pencil (**Edit sunbed**). Fields: Label (a free name such as "VIP
Left"), Price (euros), the Active / Disabled switch, and under advanced: Number, Group, Rotation,
Category. Changes save automatically (an indicator shows Saving / Saved). There is also a **QR Code**
button for that sunbed and a **Delete sunbed** control.

## Assigning to parcels {#assign}

With some sunbeds selected (not a complete parcel), **Assign** offers "Parcel n" or "+ New parcel (n)"
and **Ungroup** removes them from their parcel.

## Statuses {#statuses}

Sunbed status values stored on the sunbed:
- **active**: placed and bookable.
- **disabled**: shown as "Disabled / Hidden from booking" in the panel; not offered to customers. Use
  this for beds out of service. A parcel-wide Hidden switch sets all its beds to disabled.
- **new**: only transient; a sunbed created but not yet placed on the map. Placing it makes it active.
- **pool**: extra seats managed from the manage (on-site) page; they are excluded from the editor and
  not drawn on the map.
Bookings are separate from the sunbed status (reserved, checked-in, held, comped and so on are
operations done on the manage page, not in the editor).

## Units and pairs {#units-pairs}

A **unit** is the physical spot: usually one parasol with one or two beds under it. Beds in the same unit
are a **pair**. The unit is what a device (indicator) is assigned to and what the printed QR code names.
- Parcels are generated with pairs when "Pair seats" is on; hand-placed single items start as a pair.
- You cannot pair or unpair two existing beds by clicking: to fix a mis-grouped unit, delete it and place
  it again (or re-apply the parcel with the Pair seats toggle).
- Whether guests may book only one bed of a unit or must book the whole unit is a site setting: General
  tab, "Reservation rules", "Allow booking part of a group".

## Seat labels and QR codes {#seat-labels-qr}

Every placed sunbed gets a seat id shown as `parcel-row-unit-member`, for example `1-2-3-1` is parcel 1,
row 2, unit 3, first bed. The first three numbers are the **unit address**: the same address you type when
assigning a device and the one the QR code points to.
- Labels are recomputed whenever sunbeds are added or removed. A unit keeps its ordinal once assigned,
  so inserting or deleting a neighbour does not rename it. Moving or rotating beds does not change labels.
- **Reverse seat numbering** and regenerating a parcel with a different shape can change which bed has
  which number. Any QR cards already printed for the changed beds then point to the wrong or old
  address, so **reprint the QR cards** for that parcel after such a change.
- **Print QR Codes** (toolbar, idle state) prints cards for the whole site; the per-sunbed panel prints
  one. The QR on a card names the unit, while the card text names the bed, so the two beds of a pair have
  different cards with the same QR target.
- Sites without a site code or a seat label fall back to a longer legacy URL which redirects to the short
  one.

## Devices {#devices}

Indicator devices are managed on the **Devices** page (`/devices`, only for operators with the devices
feature enabled). A device is assigned to a unit by typing its address as `parcel-row-unit`, for example
`1-10-3`; the server refuses an address that holds no unit. Deleting every bed of a unit that has a device,
or shrinking a parcel past it, is refused until the device is reassigned.

## Layout from an aerial photo {#aerial-photo}

The assistant can set up parcels from a **top-down drone photo** of the beach (map layout only):

1. Attach the photo in the assistant and ask it to lay out the sunbeds from it.
2. The photo appears over the map. Drag it, rotate / scale it with the corner handle and use the
   opacity slider until it matches the map (existing parcels and the shoreline help). Drone photos
   with GPS data start roughly in place. Confirm.
3. The assistant proposes one parcel per regular block of sunbeds, with a confidence per parcel,
   as a card with a ghost preview. Check it against the photo, then Apply (Undo within 24 hours).

Use your own photo, taken straight down. Photos taken at an angle cannot be measured, and the
assistant never uses satellite or Google imagery. Rows hidden under parasols are counted where the
spacing makes them clear and flagged; parcels with low confidence are left out. Each photo uses one
of 3 photo readings per day.

## Deleting {#deleting}

Delete a selection with the trash icon in the selection bar, a single bed with **Delete sunbed**, a whole
parcel with **Delete parcel**. Deletes cannot be undone. Beds with a device are protected (see Devices).

## Switching layout mode {#layout-mode}

Map vs schematic is chosen on the General tab ("Layout mode"). It is locked once any sunbed exists:
delete all sunbeds to switch.
