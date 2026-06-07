/**
 * Cloud sync invite-code auth (server-side only).
 *
 * Trust model
 *   - Operator pre-shares a set of invite codes via env `CLOUD_INVITE_CODES`.
 *   - Anyone with a valid invite code can register once (creates a user row).
 *   - The same invite code on a different browser logs into the same account
 *     (the code IS the identity).
 *   - On success we issue an opaque session token stored in SQLite and a
 *     httpOnly cookie on the response.
 *
 * Why not JWT? Because we want server-side revocation (delete from `sessions`
 * table) and don't want to manage a signing secret outside what the operator
 * already configures.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getCloudServerConfig } from "./cloud-config";
import { getDb, type SessionRow, type UserRow } from "./db";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Stable user id derived from the invite code itself: `user_<sha256[0..16]>`.
 * Using a hash (not the raw code) keeps the code out of URLs/logs even though
 * it isn't strictly secret across the small team of operators.
 */
function deriveUserId(inviteCode: string): string {
  return `user_${sha256Hex(inviteCode.toLowerCase()).slice(0, 16)}`;
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Returns true if the given code matches any configured invite code. */
export function isInviteCodeAllowed(code: string): boolean {
  const { inviteCodes } = getCloudServerConfig();
  if (inviteCodes.length === 0) return false;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return false;
  return inviteCodes.some((allowed) => constantTimeEq(allowed, normalized));
}

export interface LoginResult {
  user: UserRow;
  sessionToken: string;
  expiresAt: number;
}

/**
 * Register-or-login. Looks up the user by the hashed invite code and
 * creates the row on first use. Always issues a fresh session token.
 */
export function loginWithInviteCode(
  inviteCode: string,
  displayName?: string,
): LoginResult {
  if (!isInviteCodeAllowed(inviteCode)) {
    const err = new Error("Invalid invite code");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }

  const db = getDb();
  const normalized = inviteCode.trim().toLowerCase();
  const userId = deriveUserId(normalized);
  const codeHash = sha256Hex(normalized);
  const now = Date.now();

  const existing = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;

  let user: UserRow;
  if (existing) {
    user = existing;
    if (displayName && displayName !== existing.display_name) {
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(
        displayName,
        userId,
      );
      user = { ...existing, display_name: displayName };
    }
  } else {
    db.prepare(
      "INSERT INTO users (id, invite_code_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, codeHash, displayName ?? null, now);
    user = {
      id: userId,
      invite_code_hash: codeHash,
      display_name: displayName ?? null,
      created_at: now,
    };
  }

  const { sessionMaxAgeSeconds } = getCloudServerConfig();
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + sessionMaxAgeSeconds * 1000;
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now, expiresAt);

  // Best-effort cleanup of expired sessions (cheap, single SQL).
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);

  return { user, sessionToken: token, expiresAt };
}

/** Resolves a session token to a user row, or null if invalid/expired. */
export function getUserFromSessionToken(token: string | undefined | null): UserRow | null {
  if (!token) return null;
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token) as SessionRow | undefined;
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(session.user_id) as UserRow | undefined;
  return user ?? null;
}

/** Revokes the given session token (logout). */
export function revokeSession(token: string | undefined | null): void {
  if (!token) return;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
