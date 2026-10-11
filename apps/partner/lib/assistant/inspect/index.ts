/** The system inspector's provider registry (track 030 G3). Add an aspect by appending a provider here. */
import { catalogProvider } from './catalog'
import { dataProvider } from './data'
import { editorProvider } from './editor'
import { featuresProvider } from './features'
import { moneyProvider } from './money'
import { readinessProvider } from './readiness'
import { spaceProvider } from './space'
import type { InspectProvider } from './types'

const providers: InspectProvider[] = []
providers.push(catalogProvider(() => providers), dataProvider, editorProvider, spaceProvider, featuresProvider, readinessProvider, moneyProvider)

export const INSPECT_PROVIDERS: readonly InspectProvider[] = providers

export const INSPECT_ASPECTS: readonly string[] = providers.map((p) => p.name)

export function getInspectProvider(name: string): InspectProvider | undefined {
  return providers.find((p) => p.name === name)
}

export { MAX_INSPECT_BYTES } from './types'
