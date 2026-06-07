/**
 * Pure-function import of a `.maic.zip` blob into IndexedDB.
 *
 * Extracted from `use-import-classroom.ts` so that non-DOM callers
 * (e.g. cloud sync) can reuse the exact same logic without going
 * through a hidden `<input type="file">`.
 *
 * The React hook `useImportClassroom` is a thin wrapper around this
 * function that adds toast/i18n/state-machine concerns.
 */
import { nanoid } from 'nanoid';
import { db, mediaFileKey } from '@/lib/utils/database';
import type {
  AudioFileRecord,
  MediaFileRecord,
  GeneratedAgentRecord,
} from '@/lib/utils/database';
import type { ClassroomManifest, ManifestScene } from '@/lib/export/classroom-zip-types';
import { rewriteAudioRefsToIds } from '@/lib/export/classroom-zip-utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('ImportClassroomCore');

export type ImportProgressPhase =
  | 'parsing'
  | 'validating'
  | 'writingMedia'
  | 'writingCourse'
  | 'done';

export interface ImportClassroomResult {
  stageId: string;
  stageName: string;
}

export interface ImportClassroomOptions {
  onProgress?: (phase: ImportProgressPhase) => void;
}

export class ImportValidationError extends Error {
  code: 'invalidManifest' | 'missingData' | 'invalidZip';
  constructor(code: ImportValidationError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'ImportValidationError';
  }
}

export async function importClassroomFromBlob(
  source: Blob | File | ArrayBuffer,
  opts: ImportClassroomOptions = {},
): Promise<ImportClassroomResult> {
  const { onProgress } = opts;
  onProgress?.('parsing');

  // Lazy-load JSZip so non-import code paths don't pay the bundle cost.
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(source as Blob | ArrayBuffer);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new ImportValidationError('invalidManifest', 'manifest.json missing');
  }

  onProgress?.('validating');
  const manifestText = await manifestFile.async('text');
  let manifest: ClassroomManifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new ImportValidationError('invalidManifest', 'manifest.json is not JSON');
  }
  if (!manifest.stage || !manifest.scenes || !Array.isArray(manifest.scenes)) {
    throw new ImportValidationError('missingData', 'manifest missing required fields');
  }

  // Generate new IDs
  const newStageId = nanoid();
  const now = Date.now();

  const newAgentIds: string[] = (manifest.agents ?? []).map(() => nanoid());
  const studentAgentIndex =
    manifest.agents?.findIndex((agent) => agent.role === 'student') ?? -1;
  const nonTeacherAgentIndex =
    manifest.agents?.findIndex((agent) => agent.role !== 'teacher') ?? -1;
  const fallbackDiscussionAgentIndex =
    studentAgentIndex >= 0
      ? studentAgentIndex
      : nonTeacherAgentIndex >= 0
        ? nonTeacherAgentIndex
        : undefined;

  const audioRefToNewId: Record<string, string> = {};
  for (const [zipPath, entry] of Object.entries(manifest.mediaIndex ?? {})) {
    if (entry.type === 'audio' && !entry.missing) {
      audioRefToNewId[zipPath] = nanoid();
    }
  }

  const mediaRefToNewId: Record<string, string> = {};
  for (const [zipPath, entry] of Object.entries(manifest.mediaIndex ?? {})) {
    if ((entry.type === 'generated' || entry.type === 'image') && !entry.missing) {
      const filename = zipPath.split('/').pop() ?? '';
      const elementId = filename.replace(/\.\w+$/, '');
      mediaRefToNewId[zipPath] = mediaFileKey(newStageId, elementId);
    }
  }

  onProgress?.('writingMedia');

  for (const [zipPath, newId] of Object.entries(audioRefToNewId)) {
    const zipEntry = zip.file(zipPath);
    if (!zipEntry) continue;
    const blob = await zipEntry.async('blob');
    const meta = manifest.mediaIndex[zipPath];
    const record: AudioFileRecord = {
      id: newId,
      blob,
      format: meta.format || 'mp3',
      duration: meta.duration,
      voice: meta.voice,
      createdAt: now,
    };
    await db.audioFiles.put(record);
  }

  for (const [zipPath, newId] of Object.entries(mediaRefToNewId)) {
    const zipEntry = zip.file(zipPath);
    if (!zipEntry) continue;
    const blob = await zipEntry.async('blob');
    const meta = manifest.mediaIndex[zipPath];

    const record: MediaFileRecord = {
      id: newId,
      stageId: newStageId,
      type: meta.mimeType?.startsWith('video/') ? 'video' : 'image',
      blob,
      mimeType: meta.mimeType || 'image/jpeg',
      size: meta.size || blob.size,
      prompt: meta.prompt || '',
      params: '',
      createdAt: now,
    };

    const posterPath = zipPath.replace(/\.\w+$/, '.poster.jpg');
    const posterEntry = zip.file(posterPath);
    if (posterEntry) {
      record.poster = await posterEntry.async('blob');
    }
    await db.mediaFiles.put(record);
  }

  onProgress?.('writingCourse');

  const stageName = manifest.stage.name || 'Imported Classroom';
  await db.stages.put({
    id: newStageId,
    name: stageName,
    description: manifest.stage.description,
    languageDirective: manifest.stage.language,
    style: manifest.stage.style,
    createdAt: manifest.stage.createdAt || now,
    updatedAt: now,
    agentIds: newAgentIds.length > 0 ? newAgentIds : undefined,
  });

  if (manifest.agents?.length) {
    const agentRecords: GeneratedAgentRecord[] = manifest.agents.map((a, i) => ({
      id: newAgentIds[i],
      stageId: newStageId,
      name: a.name,
      role: a.role,
      persona: a.persona,
      avatar: a.avatar,
      color: a.color,
      priority: a.priority,
      createdAt: now,
    }));
    await db.generatedAgents.bulkPut(agentRecords);
  }

  const sceneRecords = manifest.scenes.map((mScene: ManifestScene, index: number) => {
    const newSceneId = nanoid();

    const actions = mScene.actions
      ? rewriteAudioRefsToIds(mScene.actions, audioRefToNewId, {
          agentIds: newAgentIds,
          fallbackDiscussionAgentIndex,
        })
      : undefined;

    let multiAgent = undefined;
    if (mScene.multiAgent?.enabled) {
      multiAgent = {
        enabled: true,
        agentIds: (mScene.multiAgent.agentIndices ?? [])
          .map((idx) => newAgentIds[idx])
          .filter(Boolean),
        directorPrompt: mScene.multiAgent.directorPrompt,
      };
    }

    return {
      id: newSceneId,
      stageId: newStageId,
      type: mScene.type,
      title: mScene.title,
      order: mScene.order ?? index,
      content: mScene.content,
      actions,
      whiteboard: mScene.whiteboards,
      multiAgent,
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.scenes.bulkPut(sceneRecords);

  onProgress?.('done');
  log.info(`Imported classroom "${stageName}" as stage ${newStageId}`);
  return { stageId: newStageId, stageName };
}
