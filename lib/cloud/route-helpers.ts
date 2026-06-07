/**
 * Shared helpers for `/api/cloud/**` route handlers.
 * Server-side only.
 */
import { NextResponse } from "next/server";

import {
  assertCloudEnabledServer,
  getCloudServerConfig,
} from "./cloud-config";
import { getUserFromSessionToken } from "./auth";
import type { UserRow } from "./db";

/** Standard error response shape used everywhere under /api/cloud. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Throws if cloud sync is disabled; converts to a 404 by the wrapper. */
export function ensureCloudEnabled(): NextResponse | null {
  try {
    assertCloudEnabledServer();
    return null;
  } catch {
    return errorResponse(404, "cloud_disabled", "Cloud sync is not enabled on this server");
  }
}

/** Reads the session cookie from a Request and resolves to a user row. */
export function getCurrentUser(req: Request): UserRow | null {
  const { sessionCookieName } = getCloudServerConfig();
  const cookieHeader = req.headers.get("cookie") ?? "";
  const token = parseCookie(cookieHeader, sessionCookieName);
  return getUserFromSessionToken(token);
}

/** Guards a handler that requires authentication. Returns user or a 401 response. */
export function requireUser(req: Request): UserRow | NextResponse {
  const user = getCurrentUser(req);
  if (!user) return errorResponse(401, "unauthorized", "Login required");
  return user;
}

/** Builds Set-Cookie for the cloud session. */
export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  const { sessionCookieName } = getCloudServerConfig();
  return [
    `${sessionCookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

/** Builds Set-Cookie that clears the cloud session. */
export function buildClearSessionCookie(): string {
  const { sessionCookieName } = getCloudServerConfig();
  return [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function parseCookie(header: string, name: string): string | undefined {
  if (!header) return undefined;
  const target = `${name}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trimStart();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return undefined;
}
