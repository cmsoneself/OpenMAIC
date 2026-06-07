/**
 * GET /api/cloud/auth/me
 * Returns the current user (null when not logged in).
 */
import { NextResponse } from "next/server";

import {
  ensureCloudEnabled,
  getCurrentUser,
} from "@/lib/cloud/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;

  const user = getCurrentUser(req);
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: user.id,
      displayName: user.display_name,
      createdAt: user.created_at,
    },
  });
}
