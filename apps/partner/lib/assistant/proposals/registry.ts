import type { KindHandler } from './types'
import { accountHandler } from './handlers/account'
import { brandHandler, slugHandler } from './handlers/brand'
import { inventoryHandler } from './handlers/inventory'
import { layoutCanvasHandler, layoutElementsHandler } from './handlers/layout'
import { placeImageHandler } from './handlers/place-image'
import { productsHandler } from './handlers/products'
import { rentalsHandler } from './handlers/rentals'
import { siteFieldsHandler } from './handlers/site-fields'
import { workingHoursHandler } from './handlers/working-hours'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL: KindHandler<any, any>[] = [
  siteFieldsHandler,
  workingHoursHandler,
  brandHandler,
  slugHandler,
  productsHandler,
  rentalsHandler,
  accountHandler,
  inventoryHandler,
  layoutElementsHandler,
  layoutCanvasHandler,
  placeImageHandler,
]

/** Every proposal kind the assistant can apply, keyed by `AssistantAction.kind`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HANDLERS: Record<string, KindHandler<any, any>> = Object.fromEntries(ALL.map((h) => [h.kind, h]))
