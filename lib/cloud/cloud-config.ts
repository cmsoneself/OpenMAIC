/**
 * Cloud Sync feature configuration (zero-impact opt-in module).
 *
 * Design contract: if `NEXT_PUBLIC_CLOUD_SYNC_ENABLED !== 'true'`, every call
 * site in the app should be gated by `CLOUD_SYNC_ENABLED`, so:
 *   - no cloud UI is rendered
 *   - no `/api/cloud/*` request is ever issued by the client
 *   - the rest of the project behaves identically to the pristine codebase
 *
 * The server-side routes themselves remain importable (Next.js builds them
 * either way), but become unreachable in practice because no client calls them.
 * They are additionally short-circuited at runtime by `assertCloudEnabledServer()`.
 */

/** Client-side flag (inlined at build time by Next.js because of `NEXT_PUBLIC_` prefix). */
export const CLOUD_SYNC_ENABLED = process.env.NEXT_PUBLIC_CLOUD_SYNC_ENABLED === 'true';

/** Server-side runtime check. Use inside `/api/cloud/**` route handlers. */
export function isCloudEnabledServer(): boolean {
  // Mirror of NEXT_PUBLIC_ flag — kept as a separate read so server-only setups
  // (e.g. Docker) can disable cloud without touching the public flag.
  return (
    process.env.NEXT_PUBLIC_CLOUD_SYNC_ENABLED === 'true' ||
    process.env.CLOUD_SYNC_ENABLED === 'true'
  );
}

/** Server-side helper that throws a 404-shaped error when cloud is off. */
export function assertCloudEnabledServer(): void {
  if (!isCloudEnabledServer()) {
    const err = new Error('Cloud sync is not enabled on this server');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
}

/**
 * Server-only configuration. Reads each call so envs picked up at runtime
 * (Docker `-e`, QNAP container env tab) take effect without rebuild.
 */
export function getCloudServerConfig() {
  return {
    /** Path to store SQLite DB + blob files. Default: `./.cloud-data` (rel to CWD). */
    dataDir: process.env.CLOUD_DATA_DIR || './.cloud-data',
    /** Optional cap on uploaded zip size, in bytes. Default 500 MB. */
    maxUploadBytes: Number(process.env.CLOUD_MAX_UPLOAD_BYTES || 500 * 1024 * 1024),
    /** Cookie name used for session token. */
    sessionCookieName: process.env.CLOUD_SESSION_COOKIE || 'openmaic_cloud_session',
    /** Session lifetime in seconds. Default 30 days. */
    sessionMaxAgeSeconds: Number(process.env.CLOUD_SESSION_MAX_AGE || 60 * 60 * 24 * 30),
    /**
     * Comma-separated invite codes that are allowed to register.
     * Example: `CLOUD_INVITE_CODES=alpha-2026,beta-bob,charlie`
     * Each user is identified by the invite code they used; the code itself
     * becomes their stable user id (lower-cased).
     */
    inviteCodes: (process.env.CLOUD_INVITE_CODES || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}
