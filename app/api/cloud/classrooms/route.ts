/**
 * GET  /api/cloud/classrooms          — list current user's classrooms
 * POST /api/cloud/classrooms          — upload a new classroom zip
 *
 * Upload accepts either:
 *   - `multipart/form-data` with a `file` field (browser FormData), or
 *   - raw `application/zip` body (curl-friendly).
 *
 * Optional query `?replaceId=<id>` overwrites an existing classroom in place
 * (so manual sync keeps a single canonical copy per course).
 */
import { NextResponse } from "next/server";

import {
  listClassrooms,
  serializeClassroom,
  uploadClassroom,
} from "@/lib/cloud/classrooms";
import { getCloudServerConfig } from "@/lib/cloud/cloud-config";
import {
  ensureCloudEnabled,
  errorResponse,
  requireUser,
} from "@/lib/cloud/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;
  const user = requireUser(req);
  if (user instanceof NextResponse) return user;

  const rows = listClassrooms(user.id);
  return NextResponse.json({ classrooms: rows.map(serializeClassroom) });
}

export async function POST(req: Request) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;
  const user = requireUser(req);
  if (user instanceof NextResponse) return user;

  const { maxUploadBytes } = getCloudServerConfig();
  const contentType = req.headers.get("content-type") ?? "";

  let zipBuffer: Buffer;
  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return errorResponse(400, "missing_file", "Form field 'file' is required");
      }
      if (file.size > maxUploadBytes) {
        return errorResponse(
          413,
          "file_too_large",
          `File exceeds ${maxUploadBytes} bytes`,
        );
      }
      zipBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      const ab = await req.arrayBuffer();
      if (ab.byteLength === 0) {
        return errorResponse(400, "empty_body", "Request body is empty");
      }
      if (ab.byteLength > maxUploadBytes) {
        return errorResponse(
          413,
          "file_too_large",
          `File exceeds ${maxUploadBytes} bytes`,
        );
      }
      zipBuffer = Buffer.from(ab);
    }
  } catch (err) {
    return errorResponse(
      400,
      "read_body_failed",
      err instanceof Error ? err.message : "Failed to read request body",
    );
  }

  const url = new URL(req.url);
  const replaceIdRaw = url.searchParams.get("replaceId");
  const replaceId =
    replaceIdRaw && /^[a-zA-Z0-9_-]+$/.test(replaceIdRaw) ? replaceIdRaw : undefined;

  try {
    const row = await uploadClassroom({
      ownerId: user.id,
      zipBuffer,
      replaceId,
    });
    return NextResponse.json({ classroom: serializeClassroom(row) });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Upload failed";
    return errorResponse(status, "upload_failed", message);
  }
}
