# Schematic layout editor

## Overview {#schematic-overview}

For sites in **Schematic** layout mode (General tab, "Layout mode": "Draw a stylized layout with pools,
areas, and POIs. Best for hotels and chiringuitos") the Inventory tab opens a drawn canvas, sized in
**metres**, instead of Google Maps. The header shows how many elements, sunbeds and parcels exist and
two fields **Width** and **Height** (5 to 500 m) for the venue area. Sunbeds and parcels are edited exactly
like on the map (see the inventory topics: parcels, rotate-spacing, units-pairs, statuses, seat labels),
the differences are below.

## Elements {#schematic-elements}

The left **palette** ("Add elements", "Drag an element onto the canvas to place it") holds:
- **Surfaces**: Water, Sand, Grass, Deck. Drawn underneath everything; when not selected you can pan
  through them.
- **Objects**: Pool (ellipse), Bar, Reception, Shower, Restroom (labelled WC).
Drag one onto the canvas to place it; it lands centred on the drop point with a preset size (for
example Water 20 x 8 m, Pool 12 x 6 m, Bar 4 x 2 m).

Click an element to select it. A floating bar offers **Bring forward**, **Send backward**,
**Edit element** and **Delete element**; the Delete / Backspace key also deletes the selected element.
Drag it to move, drag its handles to resize. **Edit element** (or double click) opens the properties:
Type, Label, Shape (Rectangle / Ellipse), Corner radius (m), Width (m), Height (m), Rotation (deg) and a
Color override.

Elements are decoration and orientation for the partner and guests; they do not affect availability or
prices.

## Sunbeds and parcels on the canvas {#schematic-parcels}

- **+ Add Parcel** then click the canvas to place a new parcel there; the form is the same as on the
  map (rows, seats per row, pairing, gaps, rotation, category, price).
- **+ Single item** places a single sunbed on click.
- Dragging a bed moves its pair; dragging with several beds selected (select the whole parcel via its
  chip to move a parcel) moves the whole selection by the same amount.
- Rotate, spacing, assign / ungroup, restore grid formation, edit parcel config, delete: same toolbar and
  step sizes as the map editor.
- Press Escape to clear selection and close panels.
- The editor works best on a larger screen; on a phone it shows a hint to that effect.

## Geo vs schematic {#geo-vs-schematic}

- **Map (geo)**: sunbed positions are latitude/longitude on a satellite map. Best for open-air beach clubs.
- **Schematic**: positions are in metres on a drawn plan. Best for hotels, pools, chiringuitos.
- The choice lives on the General tab and is **locked once sunbeds exist**. To switch, delete all sunbeds
  first. The two layouts are stored separately, so switching does not convert one into the other.

## Importing a drawn plan {#schematic-plan-import}

On a schematic site the assistant can read a **drawn or printed plan** (a photo, scan or screenshot of
the venue: water, pool, bar, decks, rows of sunbeds) and propose the matching layout. Attach the image
in the assistant and ask for it. It needs a scale: tell it one real size ("the whole area is 60 m wide")
unless the drawing shows a scale bar or its size. You get up to four cards to apply in order: the canvas
size, the elements, the sunbed parcels and (if asked) the picture as the **underlay** to trace over.
Anything it was unsure about is listed as "please check". Each card has a ghost preview and can be undone
within 24 hours. Limits: images only (not PDF), 10 plan or document readings per day.
