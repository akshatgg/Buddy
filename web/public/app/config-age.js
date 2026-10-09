// When the config fetched from GET /api/config is too old to go by (the Mac does the same: src/main/cloud.js FRESH_MS).

export const CONFIG_FRESH_MS = 60_000;

/** True when there is no config, or it was fetched `FRESH_MS` or more ago. `fetchedAt` is Date.now() at that time. */
export function configStale(config, fetchedAt, now = Date.now()) {
  return !config || !(now - fetchedAt < CONFIG_FRESH_MS);
}
