/**
 * Claude adapter for the lead agent — now `@repo/agent/claude-model` (track 030 S0). Re-exported
 * so marketing's imports (`./claude-model.ts`, the routes, the eval) are unchanged. The live chat
 * and guide still run `claude-haiku-4-5` (or LEAD_AGENT_MODEL) with the same request as before.
 */
export * from '@repo/agent/claude-model'
