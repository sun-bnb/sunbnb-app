/**
 * The registered assistant tools, read lazily. `tools/index.ts` imports the `inspect` tool which imports
 * these providers, so the registry is only touched at CALL time (never at module load) to keep the
 * import cycle harmless.
 */
import type { AssistantTool } from '../tools/helpers'

export async function registeredTools(): Promise<readonly AssistantTool[]> {
  const { getAssistantTools } = await import('../tools')
  return getAssistantTools()
}
