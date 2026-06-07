/**
 * Cloud sync file storage adapter (server-side only).
 *
 * Stores raw `.maic.zip` payloads on the local filesystem under
 * `<dataDir>/blobs/<classroom-id>.zip`. Kept separate from SQLite
 * to avoid bloating the DB file with megabytes of binary data.
 */
import { mkdirSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getCloudServerConfig } from "./cloud-config";

function blobsDir(): string {
  const { dataDir } = getCloudServerConfig();
  return resolve(join(dataDir, "blobs"));
}

function blobPath(classroomId: string): string {
  // Defensive: only allow safe filename chars to prevent traversal.
  const safe = classroomId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe || safe !== classroomId) {
    throw new Error(`Invalid classroom id: ${classroomId}`);
  }
  return join(blobsDir(), `${safe}.zip`);
}

function ensureBlobsDir() {
  try {
    mkdirSync(blobsDir(), { recursive: true });
  } catch {
    // already exists is fine
  }
}

export async function writeClassroomBlob(
  classroomId: string,
  data: Buffer | Uint8Array,
): Promise<void> {
  ensureBlobsDir();
  await writeFile(blobPath(classroomId), data);
}

export async function readClassroomBlob(classroomId: string): Promise<Buffer> {
  return await readFile(blobPath(classroomId));
}

export async function deleteClassroomBlob(classroomId: string): Promise<void> {
  await rm(blobPath(classroomId), { force: true });
}

export async function classroomBlobExists(classroomId: string): Promise<boolean> {
  try {
    await stat(blobPath(classroomId));
    return true;
  } catch {
    return false;
  }
}
