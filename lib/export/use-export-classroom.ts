'use client';

import { useState, useCallback } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  CLASSROOM_ZIP_EXTENSION,
} from './classroom-zip-types';
import { createLogger } from '@/lib/logger';
import {
  inlineHtmlAssets,
  type InlineOptions,
  type InlineReport,
} from './inline-assets';
import type { SceneContent } from '@/lib/types/stage';
import {
  buildClassroomZipBlob,
  type BuildClassroomZipResult,
} from './build-classroom-zip';

export async function inlineSceneContent(
  content: SceneContent,
  options?: InlineOptions,
): Promise<{ content: SceneContent; report: InlineReport }> {
  if (content?.type !== 'interactive' || !('html' in content) || !content.html) {
    return { content, report: { inlined: [], failed: [] } };
  }
  const { html, report } = await inlineHtmlAssets(content.html, options);
  return { content: { ...content, html }, report };
}

const log = createLogger('ExportClassroom');

export function useExportClassroom() {
  const [exporting, setExporting] = useState(false);
  const { t } = useI18n();

  /**
   * Build the zip blob without triggering a browser download.
   * Used by cloud sync and other programmatic consumers.
   */
  const exportClassroomZipBlob = useCallback(async (): Promise<BuildClassroomZipResult | null> => {
    setExporting(true);
    try {
      return await buildClassroomZipBlob();
    } finally {
      setExporting(false);
    }
  }, []);

  /**
   * Build and download the classroom zip (original API, unchanged behaviour).
   */
  const exportClassroomZip = useCallback(async () => {
    const toastId = toast.loading(t('export.exporting'));

    try {
      const result = await exportClassroomZipBlob();
      if (!result) {
        // buildClassroomZipBlob returns null when no stage / no scenes
        toast.dismiss(toastId);
        return;
      }
      const { blob, stageName, inlineReport } = result;

      const safeName = stageName.replace(/[\\/:*?"<>|]/g, '_') || 'classroom';
      saveAs(blob, `${safeName}${CLASSROOM_ZIP_EXTENSION}`);

      if (inlineReport.failed.length > 0) {
        log.warn('Some interactive-scene assets could not be inlined:', inlineReport.failed);
        const hosts = [
          ...new Set(
            inlineReport.failed.map((f) => {
              try {
                return new URL(f.url).host;
              } catch {
                return f.url;
              }
            }),
          ),
        ];
        toast.warning(t('export.inlinePartial', { count: inlineReport.failed.length }), {
          description: hosts.join(', '),
        });
      }
      toast.success(t('export.exportSuccess'), { id: toastId });
    } catch (error) {
      log.error('Classroom ZIP export failed:', error);
      toast.error(t('export.exportFailed'), { id: toastId });
    }
  }, [t, exportClassroomZipBlob]);

  return { exporting, exportClassroomZip, exportClassroomZipBlob };
}
