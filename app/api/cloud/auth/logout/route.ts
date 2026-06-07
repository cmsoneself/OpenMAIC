/**
 * POST /api/cloud/auth/logout
 * Revokes the current session and clears the cookie.
 */
import { NextResponse } from "next/server";

import { revokeSession } from "@/lib/cloud/auth";
import { getCloudServerConfig } from "@/lib/cloud/cloud-config";
import {
  buildClearSessionCookie,
  ensureCloudEnabled,
} from "@/lib/cloud/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;

  const { sessionCookieName } = getCloudServerConfig();
  const cookieHeader = req.headers.get("cookie") ?? "";
  const target = `${sessionCookieName}=`;
  let token: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trimStart();
    if (trimmed.startsWith(target)) {
      token = decodeURIComponent(trimmed.slice(target.length));
      break;
    }
  }
  revokeSession(token);

  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", buildClearSessionCookie());
  return res;
}
