'use client';

/**
 * useCloudSync — React hook for cloud sync operations.
 *
 * Provides:
 *   - pushCurrent(): exports the open classroom and uploads it
 *   - pullById(id): downloads + imports a remote classroom
 *   - list(): fetches remote classroom list
 *   - deleteRemote(id): deletes a remote classroom
 *   - login / logout / session check
 */
import { useState, useCallback, useRef } from 'react';

import { CLOUD_SYNC_ENABLED } from './cloud-config';
import { cloudApi, type CloudUserDto, type ClassroomDto } from './cloud-client';
import { useExportClassroom } from '@/lib/export/use-export-classroom';
import { importClassroomFromBlob, type ImportProgressPhase } from '@/lib/import/import-classroom-core';
import { createLogger } from '@/lib/logger';

const log = createLogger('CloudSync');

export type SyncStatus = 'idle' | 'pushing' | 'pulling' | 'listing';

export interface UseCloudSyncReturn {
  /** Whether cloud sync is available (feature flag + server health). */
  enabled: boolean;
  /** Whether we checked the server health. */
  ready: boolean;

  user: CloudUserDto | null;
  status: SyncStatus;
  classrooms: ClassroomDto[];
  /** Progress phase during a pull. */
  importPhase: ImportProgressPhase | null;

  /** Check server health and current session. Call once on mount. */
  checkHealth: () => Promise<void>;
  login: (inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Export current classroom and upload to server. */
  pushCurrent: () => Promise<ClassroomDto | null>;
  /** Download and import a remote classroom. Returns the new stage ID. */
  pullById: (id: string) => Promise<string | null>;
  /** Refresh the remote classroom list. */
  list: () => Promise<void>;
  /** Delete a remote classroom. */
  deleteRemote: (id: string) => Promise<boolean>;
}

export function useCloudSync(): UseCloudSyncReturn {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<CloudUserDto | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [classrooms, setClassrooms] = useState<ClassroomDto[]>([]);
  const [importPhase, setImportPhase] = useState<ImportProgressPhase | null>(null);
  const { exportClassroomZipBlob } = useExportClassroom();

  const pullingRef = useRef(false);

  const checkHealth = useCallback(async () => {
    if (!CLOUD_SYNC_ENABLED) {
      setReady(true);
      return;
    }
    try {
      const health = await cloudApi.health();
      if (!health.ok) {
        setReady(false);
        return;
      }
      const { user: curUser } = await cloudApi.me();
      setUser(curUser);
      setReady(true);
    } catch (err) {
      log.warn('Cloud health check failed:', err);
      setReady(false);
    }
  }, []);

  const login = useCallback(async (inviteCode: string) => {
    const result = await cloudApi.login(inviteCode);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await cloudApi.logout();
    setUser(null);
    setClassrooms([]);
  }, []);

  const list = useCallback(async () => {
    setStatus('listing');
    try {
      const result = await cloudApi.listClassrooms();
      setClassrooms(result.classrooms);
    } finally {
      setStatus('idle');
    }
  }, []);

  const pushCurrent = useCallback(async (): Promise<ClassroomDto | null> => {
    setStatus('pushing');
    try {
      const result = await exportClassroomZipBlob();
      if (!result) return null;

      // Check if we already have one with the same title → replace it.
      const { classrooms: remoteList } = await cloudApi.listClassrooms();
      const replaceId = remoteList.length === 1 ? remoteList[0].id : undefined;

      const uploadResult = await cloudApi.uploadClassroom(result.blob, replaceId);
      return uploadResult === 'too_large' ? null : uploadResult.classroom;
    } finally {
      setStatus('idle');
    }
  }, [exportClassroomZipBlob]);

  const pullById = useCallback(async (id: string): Promise<string | null> => {
    if (pullingRef.current) return null;
    pullingRef.current = true;
    setStatus('pulling');
    setImportPhase('parsing');

    try {
      const download = await cloudApi.downloadClassroom(id);
      if (!download) return null;

      setImportPhase('parsing');
      const result = await importClassroomFromBlob(download.data, {
        onProgress: (phase) => setImportPhase(phase),
      });
      return result.stageId;
    } finally {
      setImportPhase(null);
      setStatus('idle');
      pullingRef.current = false;
    }
  }, []);

  const deleteRemote = useCallback(async (id: string): Promise<boolean> => {
    try {
      await cloudApi.deleteClassroom(id);
      setClassrooms((prev) => prev.filter((c) => c.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    enabled: CLOUD_SYNC_ENABLED,
    ready,
    user,
    status,
    classrooms,
    importPhase,
    checkHealth,
    login,
    logout,
    pushCurrent,
    pullById,
    list,
    deleteRemote,
  };
}