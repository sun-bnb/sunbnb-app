import type { AssistantTool } from './helpers'
import { getAccountingSummary, getRevenueTrend } from './accounting'
import { listProducts, listRentalItems } from './catalog'
import { explainFeatureTool } from './explain'
import { extractSchematicFromPlan } from './extract-plan'
import { findSeats, getParcel, listLayoutElements, listParcels, measureParcelsTool, requestQrPrint } from './inventory'
import { proposalTools } from './propose'
import { proposeLayoutFromPhoto, requestPhotoAlignment } from './propose-aerial'
import { getAccountProfile, getBrand, getContent, getSiteOverview, getWorkingHours } from './site'

export type { AssistantToolCtx, AssistantTool } from './helpers'

let registry: AssistantTool[] | null = null

/** Read tools (S2) plus the proposal-only write tools (S3). Built lazily (explain_feature's topic enum reads the knowledge files). */
export function getAssistantTools(): readonly AssistantTool[] {
  registry ??= [
    getSiteOverview,
    listParcels,
    getParcel,
    measureParcelsTool,
    findSeats,
    listLayoutElements,
    listProducts,
    listRentalItems,
    getWorkingHours,
    getBrand,
    getContent,
    getAccountProfile,
    getAccountingSummary,
    getRevenueTrend,
    explainFeatureTool(),
    requestQrPrint,
    ...proposalTools,
    extractSchematicFromPlan,
    requestPhotoAlignment,
    proposeLayoutFromPhoto,
  ]
  return registry
}

/** Short human phrase for a tool name (falls back to the name for an unknown tool). */
export function toolLabel(name: string): string {
  return getAssistantTools().find((t) => t.name === name)?.label ?? name
}
