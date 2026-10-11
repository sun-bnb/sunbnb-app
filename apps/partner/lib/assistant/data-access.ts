/**
 * Whether the DB-enforced assistant reader is configured (track 030 D2): `ASSISTANT_DB_URL` (the
 * `assistant_reader` connection string) and `ASSISTANT_DB_CLAIM_SECRET`. When either is unset the
 * `sql` tool and `run_js` data inputs degrade to `data_access_not_configured` instead of throwing --
 * that is also the kill switch (unset the env var and redeploy).
 */
export const DATA_ACCESS_NOT_CONFIGURED = 'data_access_not_configured'

export const assistantDataConfigured = (): boolean => Boolean(process.env.ASSISTANT_DB_URL && process.env.ASSISTANT_DB_CLAIM_SECRET)

export const notConfigured = () =>
  ({
    ok: false as const,
    error: DATA_ACCESS_NOT_CONFIGURED,
    reason: DATA_ACCESS_NOT_CONFIGURED,
    detail: 'Querying site data is switched off on this deployment. Use the specific read tools (list_parcels, get_site_overview, ...) instead.',
  })
