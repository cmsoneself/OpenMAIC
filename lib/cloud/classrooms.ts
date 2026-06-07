/**
 * Cloud sync — classroom CRUD helpers (server-side).
 *
 * Pulls a minimal title/description out of the uploaded `.maic.zip` so we
 * can list courses without keeping the zip open. Uses jszip (already a
 * project dep, used by the export/import hooks).
 */
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";

import {
  classroomBlobExists,
  deleteClassroomBlob,
  readClassroomBlob,
  writeClassroomBlob,
} from "./storage";
import { getDb, type ClassroomRow } from "./db";

interface ZipMeta {
  title: string;
  description?: string;
}

async function extractZipMeta(buf: Buffer): Promise<ZipMeta> {
  const zip = await JSZip.loadAsync(buf);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw Object.assign(new Error("Uploaded file is missing manifest.json"), {
      status: 400,
    });
  }
  const text = await manifestEntry.async("string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("manifest.json is not valid JSON"), {
      status: 400,
    });
  }
  const obj = parsed as Record<string, unknown> | null;
  const stage =
    obj && typeof obj === "object"
      ? (obj.stage as Record<string, unknown> | undefined)
      : undefined;
  const title =
    typeof stage?.name === "string" && stage.name.trim()
      ? stage.name.trim().slice(0, 200)
      : "Untitled classroom";
  const description =
    typeof stage?.description === "string"
      ? stage.description.trim().slice(0, 500)
      : undefined;
  return { title, description };
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function newClassroomId(): string {
  // RFC4122 with `-` stripped so it survives our `[^a-zA-Z0-9_-]` filter.
  return `c_${randomUUID().replace(/-/g, "")}`;
}

export interface UploadClassroomInput {
  ownerId: string;
  zipBuffer: Buffer;
  /** Overwrite target. If set, replaces the existing blob (must belong to ownerId). */
  replaceId?: string;
}

export async function uploadClassroom(input: UploadClassroomInput): Promise<ClassroomRow> {
  const meta = await extractZipMeta(input.zipBuffer);
  const hash = sha256(input.zipBuffer);
  const db = getDb();
  const now = Date.now();

  if (input.replaceId) {
    const existing = db
      .prepare("SELECT * FROM classrooms WHERE id = ? AND owner_id = ?")
      .get(input.replaceId, input.ownerId) as ClassroomRow | undefined;
    if (!existing) {
      throw Object.assign(new Error("Classroom not found"), { status: 404 });
    }
    await writeClassroomBlob(existing.id, input.zipBuffer);
    db.prepare(
      `UPDATE classrooms
         SET title = ?, description = ?, size_bytes = ?, sha256 = ?, updated_at = ?
         WHERE id = ?`,
    ).run(
      meta.title,
      meta.description ?? null,
      input.zipBuffer.byteLength,
      hash,
      now,
      existing.id,
    );
    return {
      ...existing,
      title: meta.title,
      description: meta.description ?? null,
      size_bytes: input.zipBuffer.byteLength,
      sha256: hash,
      updated_at: now,
    };
  }

  const id = newClassroomId();
  await writeClassroomBlob(id, input.zipBuffer);
  db.prepare(
    `INSERT INTO classrooms
       (id, owner_id, title, description, size_bytes, sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ownerId,
    meta.title,
    meta.description ?? null,
    input.zipBuffer.byteLength,
    hash,
    now,
    now,
  );
  return {
    id,
    owner_id: input.ownerId,
    title: meta.title,
    description: meta.description ?? null,
    size_bytes: input.zipBuffer.byteLength,
    sha256: hash,
    created_at: now,
    updated_at: now,
  };
}

export function listClassrooms(ownerId: string): ClassroomRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM classrooms WHERE owner_id = ? ORDER BY updated_at DESC",
    )
    .all(ownerId) as ClassroomRow[];
}

export function getClassroomMeta(ownerId: string, id: string): ClassroomRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM classrooms WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) as ClassroomRow | undefined) ?? null
  );
}

export async function downloadClassroom(
  ownerId: string,
  id: string,
): Promise<{ row: ClassroomRow; data: Buffer } | null> {
  const row = getClassroomMeta(ownerId, id);
  if (!row) return null;
  if (!(await classroomBlobExists(id))) return null;
  const data = await readClassroomBlob(id);
  return { row, data };
}

export async function deleteClassroom(ownerId: string, id: string): Promise<boolean> {
  const row = getClassroomMeta(ownerId, id);
  if (!row) return false;
  const db = getDb();
  db.prepare("DELETE FROM classrooms WHERE id = ? AND owner_id = ?").run(id, ownerId);
  await deleteClassroomBlob(id);
  return true;
}

export function serializeClassroom(row: ClassroomRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
