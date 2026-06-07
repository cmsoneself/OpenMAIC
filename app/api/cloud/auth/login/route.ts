/**
 * POST /api/cloud/auth/login
 *
 * Body: { inviteCode: string, displayName?: string }
 * On success: sets the session cookie and returns the user profile.
 */
import { NextResponse } from "next/server";

import { loginWithInviteCode } from "@/lib/cloud/auth";
import { getCloudServerConfig } from "@/lib/cloud/cloud-config";
import {
  buildSessionCookie,
  ensureCloudEnabled,
  errorResponse,
} from "@/lib/cloud/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LoginBody {
  inviteCode?: unknown;
  displayName?: unknown;
}

export async function POST(req: Request) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;

  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return errorResponse(400, "bad_json", "Request body must be JSON");
  }

  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : "";
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 64)
      : undefined;

  if (!inviteCode) {
    return errorResponse(400, "missing_invite_code", "inviteCode is required");
  }

  try {
    const { user, sessionToken, expiresAt } = loginWithInviteCode(
      inviteCode,
      displayName,
    );
    const { sessionMaxAgeSeconds } = getCloudServerConfig();
    const res = NextResponse.json({
      user: {
        id: user.id,
        displayName: user.display_name,
        createdAt: user.created_at,
      },
      expiresAt,
    });
    res.headers.set(
      "Set-Cookie",
      buildSessionCookie(sessionToken, sessionMaxAgeSeconds),
    );
    return res;
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Login failed";
    return errorResponse(status, status === 401 ? "invalid_invite_code" : "login_failed", message);
  }
}
