/**
 * GET /api/cloud/health
 *
 * Liveness + capability probe. Used by the client to decide whether to show
 * the cloud panel and to surface configuration mistakes (e.g. operator
 * forgot to set CLOUD_INVITE_CODES).
 *
 * Returns 404 when the feature flag is off so the endpoint is indistinguishable
 * from a non-existent route.
 */
import { NextResponse } from "next/server";

import { getCloudServerConfig } from "@/lib/cloud/cloud-config";
import { ensureCloudEnabled } from "@/lib/cloud/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;

  const cfg = getCloudServerConfig();
  return NextResponse.json({
    ok: true,
    inviteCodeRequired: true,
    inviteCodesConfigured: cfg.inviteCodes.length > 0,
    maxUploadBytes: cfg.maxUploadBytes,
    sessionMaxAgeSeconds: cfg.sessionMaxAgeSeconds,
  });
}
