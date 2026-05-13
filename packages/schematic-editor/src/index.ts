// Public API of @repo/schematic-editor.
//
// Shared editor chrome that sits on top of @repo/schematic's low-level
// renderer. Brand-neutral, product-neutral — the beach sunbed editor and
// the restaurant tables editor both compose these pieces.

export {
  SaveStatusBanner,
  type SaveStatusBannerProps,
  type SaveStatusBannerLabels,
  type SaveStatus,
} from './chrome/SaveStatusBanner'

export {
  CanvasDimensionsHeader,
  type CanvasDimensionsHeaderProps,
  type CanvasDimensionsHeaderLabels,
} from './chrome/CanvasDimensionsHeader'

export {
  ElementPropertiesSidebar,
  type ElementPropertiesSidebarProps,
  type ElementPropertiesSidebarLabels,
} from './sidebar/ElementPropertiesSidebar'

export { useEditorKeyboard, type UseEditorKeyboardOptions } from './selection/useEditorKeyboard'
