/**
 * `catalog` aspect: the map of the inspector itself plus which tool answers what. Aspects are read from
 * the provider registry (so a new provider is listed automatically); the tool guide is filtered to the
 * tools actually registered, so it never points at a tool the model does not have (e.g. `run_js`
 * until it is registered).
 */
import { assistantDataConfigured, DATA_ACCESS_NOT_CONFIGURED } from '../data-access'
import { registeredTools } from './tool-source'
import type { InspectProvider } from './types'

interface Guide { question: string; use: string[] }

export const TOOL_GUIDE: readonly Guide[] = [
  { question: 'Overview of the site, its counts, payment readiness', use: ['get_site_overview', 'inspect:readiness'] },
  { question: 'Current parcels, a parcel, sunbeds by id, layout elements, products, rentals, hours, brand, content, company profile', use: ['list_parcels', 'get_parcel', 'find_seats', 'list_layout_elements', 'list_products', 'list_rental_items', 'get_working_hours', 'get_brand', 'get_content', 'get_account_profile'] },
  { question: 'Counts, sums, rankings, occupancy, revenue by day / parcel / product, "which seats ..."', use: ['sql', 'inspect:data'] },
  { question: 'Accounting month summary and revenue trend', use: ['get_accounting_summary', 'get_revenue_trend', 'sql'] },
  { question: 'Where is something, how far, which is nearest, which way is the sea, alignment', use: ['describe_site_area', 'measure', 'measure_to_sea', 'measure_parcels', 'inspect:space'] },
  { question: 'Data model: which tables and columns exist and how they relate', use: ['inspect:data'] },
  { question: 'What the inventory / schematic editors can do, limits, undo, QR reprint, manual UI path', use: ['inspect:editor', 'explain_feature'] },
  { question: 'Step-by-step how-to in the portal UI', use: ['explain_feature'] },
  { question: 'Plan, subscription, what is locked, feature flags, site features', use: ['inspect:features'] },
  { question: 'Commission, fees, VAT, how a sale is split', use: ['inspect:money', 'get_accounting_summary'] },
  { question: 'Is the site ready to go live, what blocks bookings, payment provider state', use: ['inspect:readiness', 'get_site_overview'] },
  { question: 'Custom calculation or data crunching that SQL and the tools above cannot express', use: ['run_js'] },
  { question: 'Change something', use: ['propose_* (see inspect:editor for the list)'] },
]

export function catalogProvider(all: () => readonly InspectProvider[]): InspectProvider {
  return {
    name: 'catalog',
    summary: 'The map of the inspector: every aspect with a summary and example questions, plus which tool answers what.',
    examples: ['Where does this information live?', 'Which tool should I use for ...?'],
    async describe() {
      const names = new Set((await registeredTools()).map((t) => t.name))
      const registered = (use: string) => use.startsWith('inspect:') || use.startsWith('propose_*') || names.has(use)
      return {
        ok: true,
        howToUse: 'inspect({ aspect, topic? }) is read-only and always about the OPEN site and its owner account. Call it when unsure where information lives; prefer inspect, sql and the spatial tools over asking the user.',
        aspects: all().map((p) => ({ aspect: p.name, summary: p.summary, ...(p.topics ? { topic: p.topics } : {}), examples: p.examples })),
        whereToLook: TOOL_GUIDE.map((g) => ({ question: g.question, use: g.use.filter(registered) })).filter((g) => g.use.length > 0),
        ...(assistantDataConfigured()
          ? {}
          : { dataAccess: `${DATA_ACCESS_NOT_CONFIGURED}: the sql tool (and run_js data tables) are switched off on this deployment; use the specific read tools.` }),
      }
    },
  }
}
