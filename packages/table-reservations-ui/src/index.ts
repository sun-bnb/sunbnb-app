// Public API of @repo/table-reservations-ui.
//
// This package owns all restaurant-product React components — the consumer
// booking flow and the partner-facing editors. Brand-neutral; consuming apps
// inject colors via Tailwind tokens and pass translation strings as props.
// Imports from @repo/ui, @repo/schematic, @repo/table-reservations-core only.
//
// Phase 1 (chiringuitos inside Sunbnb) and Phase 2 (standalone tablefind apps)
// both render these same components.

export {
  RestaurantSettingsForm,
  type RestaurantSettingsFormProps,
  type RestaurantSettingsLabels,
  type RestaurantSettingsValues,
  type SaveStatus,
} from './partner/RestaurantSettingsForm'

export {
  RestaurantHoursEditor,
  type RestaurantHoursEditorProps,
  type RestaurantHoursEditorLabels,
} from './partner/RestaurantHoursEditor'

export {
  EnableRestaurantCta,
  type EnableRestaurantCtaProps,
  type EnableRestaurantCtaLabels,
} from './partner/EnableRestaurantCta'

export {
  TableLayoutEditor,
  type TableLayoutEditorProps,
  type TableLayoutEditorLabels,
} from './partner/TableLayoutEditor'

export {
  TableForm,
  type TableFormProps,
  type TableFormLabels,
  type TableFormValues,
} from './partner/TableForm'

export {
  ElementPalette,
  type ElementPaletteProps,
  type ElementPaletteLabels,
} from './partner/ElementPalette'

export {
  restaurantPalette,
  RESTAURANT_SURFACE_TYPES,
  RESTAURANT_OBJECT_TYPES,
  RESTAURANT_ELEMENT_PRESETS,
} from './partner/restaurantPalette'

export {
  MenuEditor,
  type MenuEditorProps,
  type MenuEditorLabels,
} from './partner/MenuEditor'

export {
  MenuItemRow,
  type MenuItemRowProps,
  type MenuItemRowLabels,
} from './partner/MenuItemRow'

export {
  MenuItemDialog,
  type MenuItemDialogProps,
  type MenuItemDialogLabels,
} from './partner/MenuItemDialog'

export type { MenuItemFormValues, MenuItemSaveResult } from './partner/menu-types'

export {
  BookTableSection,
  type BookTableSectionProps,
  type BookTableSectionLabels,
} from './consumer/BookTableSection'

export {
  AvailabilityPicker,
  type AvailabilityPickerProps,
  type AvailabilityPickerLabels,
} from './consumer/AvailabilityPicker'

export {
  BookingForm,
  type BookingFormProps,
  type BookingFormLabels,
  type BookingFormValues,
} from './consumer/BookingForm'

export {
  ConfirmationCard,
  type ConfirmationCardProps,
  type ConfirmationCardLabels,
  type ConfirmationCardReservation,
} from './consumer/ConfirmationCard'

export {
  ReservationList,
  type ReservationListProps,
  type ReservationListLabels,
  type ReservationFilter,
} from './partner/ReservationList'

export {
  ReservationRow,
  type ReservationRowProps,
  type ReservationRowLabels,
} from './partner/ReservationRow'
