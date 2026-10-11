/**
 * The assistant's WRITE tools (track 030 S3): proposal-only. None of them changes anything -- each
 * validates the request with the same rules as the real server action, reads the CURRENT values to
 * build a before -> after preview, stores an `AssistantAction(status=proposed)` and emits the
 * `proposal` SSE event. The user applies it with the card's button (`applyAssistantAction`), which
 * re-authorises and re-checks staleness before running the existing actions.
 *
 * Deliberately absent (track 030 D3): bank account / IBAN, payment provider, Stripe / KYC,
 * Verifactu -- no tool or schema property reaches them.
 */
import { accountHandler, planAccountFields } from '../proposals/handlers/account'
import { brandHandler, planBrand, planSlug, slugHandler } from '../proposals/handlers/brand'
import { PLACE_TARGETS, placeImageHandler, planPlaceImage } from '../proposals/handlers/place-image'
import { planProducts, productsHandler } from '../proposals/handlers/products'
import { planRentals, rentalsHandler } from '../proposals/handlers/rentals'
import { planSiteFields, siteFieldsHandler, SERVICE_VALUES } from '../proposals/handlers/site-fields'
import { DAY_SHORT, planWorkingHours, workingHoursHandler } from '../proposals/handlers/working-hours'
import type { AssistantTool } from './helpers'
import { inventoryTools } from './propose-inventory'
import { layoutTools } from './propose-layout'
import { proposeTool } from './propose-core'

export const proposeSiteFields = proposeTool({
  name: 'propose_site_fields',
  label: 'Preparing a site change',
  description:
    'Propose changes to the open site\'s General / Content fields: name, price per sunbed (gross, VAT included), VAT percent, description, on-site services, visibility (active/hidden), allow booking part of a group. Give only the fields to change. price 0 or null clears the price.',
  properties: {
    name: { type: 'string', maxLength: 200 },
    price: { type: ['number', 'null'], minimum: 0, maximum: 100000, description: 'Gross price per sunbed, VAT included' },
    vat: { type: ['number', 'null'], minimum: 0, maximum: 100, description: 'VAT percent' },
    description: { type: 'string', maxLength: 5000 },
    services: { type: 'array', items: { type: 'string', enum: [...SERVICE_VALUES] }, maxItems: 20 },
    status: { type: 'string', enum: ['active', 'hidden'] },
    partialGroupBooking: { type: 'boolean' },
  },
  handler: siteFieldsHandler,
  plan: (input) => planSiteFields(input),
})

export const proposeWorkingHours = proposeTool({
  name: 'propose_working_hours',
  label: 'Preparing opening hours',
  description:
    'Propose booking/working hours. `week` lists the days to set; each day listed has ALL its ranges replaced (repeat a day for two ranges, e.g. 09:00-13:00 and 15:00-19:00; closed:true makes the day closed). Days not listed are left as they are. Times are 24 h HH:MM, close after open.',
  properties: {
    week: {
      type: 'array',
      minItems: 1,
      maxItems: 28,
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAY_SHORT.slice(1) },
          open: { type: 'string', description: 'HH:MM' },
          close: { type: 'string', description: 'HH:MM' },
          closed: { type: 'boolean' },
        },
        required: ['day'],
        additionalProperties: false,
      },
    },
  },
  required: ['week'],
  handler: workingHoursHandler,
  plan: (input) => planWorkingHours(input),
})

export const proposeBrand = proposeTool({
  name: 'propose_brand',
  label: 'Preparing brand settings',
  description:
    'Propose Brand tab changes: brand name, tagline, background colour, text colour (hex like #faf9f6). Refused when the site has a custom brand page live. The public address is a separate tool (propose_slug).',
  properties: {
    brandName: { type: 'string', maxLength: 200 },
    tagline: { type: 'string', maxLength: 500 },
    bgColor: { type: 'string', description: 'Hex colour' },
    fgColor: { type: 'string', description: 'Hex colour' },
  },
  handler: brandHandler,
  plan: (input) => planBrand(input),
})

export const proposeSlug = proposeTool({
  name: 'propose_slug',
  label: 'Preparing the public address',
  description: 'Propose the site\'s public booking-page address (slug): lowercase letters, digits and dashes, 3-60 characters, must be free.',
  properties: { slug: { type: 'string', maxLength: 100 } },
  required: ['slug'],
  handler: slugHandler,
  plan: (input, ctx) => planSlug(input, ctx.siteId),
})

export const proposeProducts = proposeTool({
  name: 'propose_products',
  label: 'Preparing menu changes',
  description:
    'Propose Products tab changes, matched BY NAME within the site. `upsert` creates or updates products (price is gross, VAT included; vat is a percent, defaults to the site VAT for new products; category food|drink|snack|accessory; soldOut). `delete` lists names to remove from the menu (not undoable). An ambiguous name returns an error: ask the user which product they mean.',
  properties: {
    upsert: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 200 },
          description: { type: ['string', 'null'], maxLength: 1000 },
          price: { type: 'number', minimum: 0, maximum: 100000, description: 'Gross price, VAT included' },
          vat: { type: 'number', minimum: 0, maximum: 100 },
          category: { type: 'string', enum: ['food', 'drink', 'snack', 'accessory'] },
          soldOut: { type: 'boolean' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    delete: { type: 'array', maxItems: 30, items: { type: 'string' } },
  },
  handler: productsHandler,
  plan: (input) => planProducts(input),
})

export const proposeRentalItems = proposeTool({
  name: 'propose_rental_items',
  label: 'Preparing rental changes',
  description:
    'Propose Rentals tab changes, matched BY NAME within the site. `upsert` creates or updates rental items (pricePerHour / pricePerDay are gross, VAT included; totalQuantity; active). `delete` lists names to delete (items with bookings cannot be deleted: deactivate instead; not undoable).',
  properties: {
    upsert: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 200 },
          description: { type: ['string', 'null'], maxLength: 1000 },
          category: { type: ['string', 'null'], maxLength: 100 },
          pricePerHour: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
          pricePerDay: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
          totalQuantity: { type: 'integer', minimum: 1, maximum: 10000 },
          active: { type: 'boolean' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    delete: { type: 'array', maxItems: 30, items: { type: 'string' } },
  },
  handler: rentalsHandler,
  plan: (input) => planRentals(input),
})

export const proposeAccountFields = proposeTool({
  name: 'propose_account_fields',
  label: 'Preparing account details',
  description:
    'Propose changes to the company ACCOUNT (shared by all the owner\'s sites): company name, business/tax id, address, city, postal code, country, phone, email, website. Give only the fields to change. Never used for bank account/IBAN, payment provider or tax-authority setup: those are not available to you, tell the user to use the Account pages.',
  properties: {
    company: { type: 'string', maxLength: 200 },
    businessId: { type: 'string', maxLength: 50 },
    address: { type: 'string', maxLength: 300 },
    city: { type: 'string', maxLength: 100 },
    postalCode: { type: 'string', maxLength: 20 },
    country: { type: 'string', maxLength: 100 },
    phoneNumber: { type: 'string', maxLength: 50 },
    email: { type: 'string', maxLength: 320 },
    websiteUrl: { type: 'string', maxLength: 2000 },
  },
  handler: accountHandler,
  plan: (input) => planAccountFields(input),
})

export const proposePlaceImage = proposeTool({
  name: 'propose_place_image',
  label: 'Preparing a photo placement',
  description:
    "Propose putting one of the user's ATTACHED PHOTOS (JPEG, PNG or WebP; never a PDF/DOCX) on a site image slot. target: cover (the Content tab cover photo), product (a product's image; give its name), rental_item (a rental item's image; give its name), brand_logo, brand_background (Brand tab; the site needs a brand and no custom brand page), schematic_underlay (the background image of a schematic site's canvas, stretched over the whole canvas). uploadId is the id of the attachment shown in the user's message. If the user did not say WHICH slot, ask before calling. The photo is copied (EXIF location removed, long edge capped at 2400 px) when the user applies; undo restores the previous image.",
  properties: {
    target: { type: 'string', enum: [...PLACE_TARGETS] },
    uploadId: { type: 'string', description: 'Id of the attached photo, exactly as given in the message' },
    name: { type: 'string', maxLength: 200, description: 'Product / rental item name (only for those targets)' },
  },
  required: ['target', 'uploadId'],
  handler: placeImageHandler,
  plan: (input, ctx) => planPlaceImage(input, { siteId: ctx.siteId, accountId: ctx.accountId }),
})

export const proposalTools: AssistantTool[] = [
  proposeSiteFields,
  proposeWorkingHours,
  proposeBrand,
  proposeSlug,
  proposeProducts,
  proposeRentalItems,
  proposeAccountFields,
  proposePlaceImage,
  ...inventoryTools,
  ...layoutTools,
]
