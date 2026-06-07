/**
 * GET    /api/cloud/classrooms/:id   — download a classroom zip
 * DELETE /api/cloud/classrooms/:id   — delete a classroom
 *
 * `GET` accepts `?meta=1` to return just metadata (no blob body).
 */
import { NextResponse } from "next/server";

import {
  deleteClassroom,
  downloadClassroom,
  getClassroomMeta,
  serializeClassroom,
} from "@/lib/cloud/classrooms";
import {
  ensureCloudEnabled,
  errorResponse,
  requireUser,
} from "@/lib/cloud/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;
  const user = requireUser(req);
  if (user instanceof NextResponse) return user;

  const { id } = await ctx.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return errorResponse(400, "bad_id", "Invalid classroom id");
  }

  const url = new URL(req.url);
  if (url.searchParams.get("meta") === "1") {
    const row = getClassroomMeta(user.id, id);
    if (!row) return errorResponse(404, "not_found", "Classroom not found");
    return NextResponse.json({ classroom: serializeClassroom(row) });
  }

  const result = await downloadClassroom(user.id, id);
  if (!result) return errorResponse(404, "not_found", "Classroom not found");

  // Best-effort safe filename; clients can still rename on save.
  // Strip characters invalid in filenames across OSes.
  const safeTitle =
    result.row.title.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").slice(0, 80) ||
    "classroom";
  const filename = `${safeTitle}.maic.zip`;

  // RFC 5987: use filename* for non-ASCII names so Chinese etc. survive
  // the HTTP header (ByteString constraint). Provide ASCII fallback too.
  const encodedFilename = encodeURIComponent(filename);

  // Convert Node Buffer -> Uint8Array for the Web Response body
  // to keep Next.js / Edge runtime types happy.
  const body = new Uint8Array(
    result.data.buffer,
    result.data.byteOffset,
    result.data.byteLength,
  );
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(result.data.byteLength),
      "Content-Disposition": `attachment; filename="classroom.maic.zip"; filename*=UTF-8''${encodedFilename}`,
      "X-Classroom-Id": result.row.id,
      "X-Classroom-Sha256": result.row.sha256,
      "X-Classroom-Updated-At": String(result.row.updated_at),
    },
  });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const disabled = ensureCloudEnabled();
  if (disabled) return disabled;
  const user = requireUser(req);
  if (user instanceof NextResponse) return user;

  const { id } = await ctx.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return errorResponse(400, "bad_id", "Invalid classroom id");
  }

  const ok = await deleteClassroom(user.id, id);
  if (!ok) return errorResponse(404, "not_found", "Classroom not found");
  return NextResponse.json({ ok: true });
}
