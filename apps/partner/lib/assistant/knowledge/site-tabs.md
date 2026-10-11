# Site tabs

The site page (`/sites/<id>`) has these tabs, in this order: **General**, **Content**, **Brand**,
**Inventory** (a schematic site shows its canvas here), **Products**, **Rentals**, **Accounting**. A site
linked to a restaurant also shows a "Manage restaurant" link. Changes in most fields **auto-save** after
a short pause (a Saving / Saved indicator shows the state).

## Going live checklist {#going-live}

A checklist ("Things to complete before going live") lists what is missing: site name, location, base
price, VAT rate, working hours (at least one day), active inventory (add sunbeds and set them active),
a cover image, and payment setup (connect the payment provider in Account > Payments).

## General {#tab-general}

- **Site name**, **Site type / reservation billing**: "Integrated payments" (customers pay when booking, collected through the
  platform) or "Off-platform billing" (no payment on the platform, for example hotel guests; no price
  is stored).
- **Price** (base price per sunbed, euros), **billing type** per day or per hour, and **VAT rate (%)**.
  Prices are VAT-inclusive; a breakdown shows what the customer pays and what the venue receives. The
  commission is deducted from the venue's revenue, never added to the customer's price.
- **Working hours / Booking hours**: add a time range per weekday (Monday to Sunday) with **Add hours**;
  **Delete** removes a range.
- **Booking window**: minimum hours before booking and maximum days ahead.
- **Reservation rules**: "Allow booking part of a group" (off by default: units are bookable only as a
  whole).
- **Location**: pick the venue on the map (latitude / longitude).
- **Layout mode**: Map or Schematic; locked while sunbeds exist.
- **Visibility / Site status**: Active (live) or Hidden (draft, not shown to customers).
- **Features**: enable equipment rentals.
- **Payment provider** is chosen per account in Account > Payments (select, then connect), not per site.
- **Danger zone**: delete the site (cannot be undone).

## Content {#tab-content}

- **Cover photo**: drag and drop or click to upload (recommended 1200 x 400 px, JPG or PNG);
  Replace to change it.
- **Description**: free text shown on the booking page.
- **On-site services**: toggles WC, Food, Drinks, Rental; shown as icons on the booking page.
Saved automatically.

## Brand {#tab-brand}

Customise the public booking page: brand name, page address (slug), tagline and colours (primary, accent,
background, foreground). Auto-saves. Plan gate: customising needs the Business plan, except sites with a
platform-delivered bespoke page, where only the address (slug) is editable. Changing the slug changes
the public URL.

## Products {#tab-products}

Food, drinks and accessories guests can order from their phone.
- **App sales** switch (guests can order from their phone) and **Order billing**: Integrated payments
  ("Pay in app") or Off-platform billing ("Pay on delivery").
- **Add product**: Name, Description (optional), Price (total, VAT-inclusive; the tab shows the price
  before tax), Tax %, Category (food, drink, snack, accessory), Prep time (min) and an Image. Products
  can be edited, marked **Sold out** or deleted.
Orders arrive on the Orders dashboard of the site.

## Rentals {#tab-rentals}

Equipment hire (surfboards, paddleboards, kayaks, pedal boats, snorkel gear and others).
- **Enable rentals** (a site feature) and **Rental billing** (Integrated or Off-platform).
- **Add item**: Name, Category, Description, Quantity (how many units exist), Price per hour and /or Price
  per day, VAT %, Image. Inactive items are hidden. Deleting an item also removes its bookings.

## Accounting {#tab-accounting}

Read-only reporting for the venue: monthly summary by source (sunbeds, rentals, orders) with refunds, net
and turnover per bed; a recent-trend chart with revenue, sunbeds and occupancy over 7, 30 or 365 days;
channel split (cash, QR, online); invoices for the month; staff cash breakdown; and CSV export. Money
shown for revenue is what customers paid (gross, VAT-inclusive). Commission invoices that Sunbnb issues to
the partner live in Account > Invoices.

## Orders and on-site operation {#orders-manage}

Outside the tabs: **Orders** (`/sites/<id>/orders`) is the live order dashboard. **Manage**
(`/sites/<id>/manage`) is the on-site floor surface protected by an access key (security token) rather
than a login: sunbed grid with walk-ins, check-in / departure, blocking, holds, comps, rentals, tills and
day close. Staff access keys are created under Security.

## Asking questions about your data {#data-questions}

The assistant can answer free-form questions about the open site's own data without a dedicated
screen: "how many active sunbeds are in parcels 3 to 7", "which parcel has the most disabled beds",
"revenue from sunbeds by week in July", "average order value on Saturdays", "which products were
never ordered", "how many bookings were checked in vs no-show last month". It runs a read-only query
over a private copy of this site's data only — parcels, sunbeds, layout elements, products, rentals,
opening hours, reservations, F&B orders and invoices. The copy is refreshed when something changed
(and at least every 10 minutes), so a booking made seconds ago may not be counted yet. Guest names,
emails, phone numbers, payment references and bank details are never in the copy, so the assistant
cannot look up a guest. Changes are never made this way: they are always proposals you apply.
