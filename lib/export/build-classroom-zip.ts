'use client';

/**
 * Pure builder that produces a `.maic.zip` Blob from the current Stage in IndexedDB.
 *
 * Extracted from `use-export-classroom.ts` so that non-DOM callers (cloud sync,
 * tests) can produce the exact same zip without triggering a browser download.
 *
 * The React hook is a thin wrapper that calls this and then `saveAs(...)`.
 */
import { db, getGeneratedAgentsByStageId } from '@/lib/utils/database';
import { useStageStore } from '@/lib/store/stage';
import { collectAudioFiles, collectMediaFiles, actionsToManifest } from './classroom-zip-utils';
import {
  CLASSROOM_ZIP_FORMAT_VERSION,
  type ClassroomManifest,
  type ManifestStage,
  type ManifestAgent,
  type ManifestScene,
  type MediaIndexEntry,
} from './classroom-zip-types';
import type { SpeechAction } from '@/lib/types/action';
import { inlineSceneContent } from './use-export-classroom';
import { createAssetFetcher, type InlineReport } from './inline-assets';
import { createProxiedFetch } from './proxied-fetch';

export interface BuildClassroomZipResult {
  blob: Blob;
  /** Latest stage name (sanitized by caller for filename use). */
  stageName: string;
  /** Inline-asset report for caller-side warnings. */
  inlineReport: InlineReport;
}

export async function buildClassroomZipBlob(): Promise<BuildClassroomZipResult | null> {
  const { stage, scenes } = useStageStore.getState();
  if (!stage?.id || scenes.length === 0) return null;

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  const freshStage = await db.stages.get(stage.id);
  const latestName = freshStage?.name || stage.name;

  const agentRecords = await getGeneratedAgentsByStageId(stage.id);
  const audioFiles = await collectAudioFiles(scenes);
  const mediaFiles = await collectMediaFiles(stage.id);

  const audioIdToPath = new Map<string, string>();
  for (const af of audioFiles) audioIdToPath.set(af.record.id, af.zipPath);

  const manifestStage: ManifestStage = {
    name: latestName,
    description: stage.description,
    language: stage.languageDirective,
    style: stage.style,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };

  const manifestAgents: ManifestAgent[] = agentRecords.map((a) => ({
    name: a.name,
    role: a.role,
    persona: a.persona,
    avatar: a.avatar,
    color: a.color,
    priority: a.priority,
  }));
  if (manifestAgents.length === 0 && stage.generatedAgentConfigs?.length) {
    for (const a of stage.generatedAgentConfigs) {
      manifestAgents.push({
        name: a.name,
        role: a.role,
        persona: a.persona,
        avatar: a.avatar,
        color: a.color,
        priority: a.priority,
      });
    }
  }

  const agentIdToIndex = new Map<string, number>();
  agentRecords.forEach((a, i) => agentIdToIndex.set(a.id, i));
  if (stage.generatedAgentConfigs?.length && agentRecords.length === 0) {
    stage.generatedAgentConfigs.forEach((a, i) => agentIdToIndex.set(a.id, i));
  }

  const aggregateReport: InlineReport = { inlined: [], failed: [] };
  const sharedFetcher = createAssetFetcher({ fetchImpl: createProxiedFetch() });
  const manifestScenes: ManifestScene[] = await Promise.all(
    scenes.map(async (scene) => {
      const { content, report } = await inlineSceneContent(scene.content, { fetcher: sharedFetcher });
      for (const u of report.inlined)
        if (!aggregateReport.inlined.includes(u)) aggregateReport.inlined.push(u);
      for (const f of report.failed)
        if (!aggregateReport.failed.some((g) => g.url === f.url)) aggregateReport.failed.push(f);
      return {
        type: scene.type,
        title: scene.title,
        order: scene.order,
        content,
        actions: scene.actions
          ? actionsToManifest(scene.actions, audioIdToPath, agentIdToIndex)
          : undefined,
        whiteboards: scene.whiteboards,
        ...(scene.multiAgent?.enabled
          ? {
              multiAgent: {
                enabled: true,
                agentIndices: (scene.multiAgent.agentIds ?? [])
                  .map((id) => agentIdToIndex.get(id))
                  .filter((i): i is number => i !== undefined),
                directorPrompt: scene.multiAgent.directorPrompt,
              },
            }
          : {}),
      };
    }),
  );

  const mediaIndex: Record<string, MediaIndexEntry> = {};
  for (const af of audioFiles) {
    mediaIndex[af.zipPath] = {
      type: 'audio',
      format: af.record.format,
      duration: af.record.duration,
      voice: af.record.voice,
    };
  }
  for (const mf of mediaFiles) {
    mediaIndex[mf.zipPath] = {
      type: 'generated',
      mimeType: mf.record.mimeType,
      size: mf.record.size,
      prompt: mf.record.prompt,
    };
  }

  for (const scene of scenes) {
    for (const action of scene.actions ?? []) {
      if (action.type === 'speech') {
        const audioId = (action as SpeechAction).audioId;
        if (audioId && !audioIdToPath.has(audioId)) {
          const missingPath = `audio/${audioId}.mp3`;
          mediaIndex[missingPath] = { type: 'audio', missing: true };
        }
      }
    }
  }

  const manifest: ClassroomManifest = {
    formatVersion: CLASSROOM_ZIP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: process.env.npm_package_version || '0.0.0',
    stage: manifestStage,
    agents: manifestAgents,
    scenes: manifestScenes,
    mediaIndex,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  for (const af of audioFiles) {
    zip.file(af.zipPath, af.record.blob);
  }
  for (const mf of mediaFiles) {
    zip.file(mf.zipPath, mf.record.blob);
    if (mf.record.poster) {
      zip.file(mf.zipPath.replace(/\.\w+$/, '.poster.jpg'), mf.record.poster);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, stageName: latestName, inlineReport: aggregateReport };
}
