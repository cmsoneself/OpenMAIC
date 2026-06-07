'use client';

/**
 * Cloud Sync Panel — embeddable UI for the cloud sync feature.
 *
 * Zero-impact contract: when `CLOUD_SYNC_ENABLED` is false this component
 * renders nothing.  All hooks and API calls are guarded.
 *
 * Can be placed as:
 *   - a standalone section on the home page (below local classrooms)
 *   - a minimal indicator in the top-right toolbar (CloudIndicator)
 */
import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudOff,
  CloudUpload,
  CloudDownload,
  LogIn,
  LogOut,
  RefreshCw,
  Loader2,
  Trash2,
  Check,
  X,
  FileDown,
  Upload,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { CLOUD_SYNC_ENABLED } from '@/lib/cloud/cloud-config';
import { useCloudSync, type SyncStatus } from '@/lib/cloud/use-cloud-sync';
import type { ImportProgressPhase } from '@/lib/import/import-classroom-core';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

// ── Props ────────────────────────────────────────────────────────────

interface CloudSyncPanelProps {
  /** Called after a successful pull so the parent can refresh its local list. */
  onPullSuccess?: () => void;
  /** Called after a successful push. */
  onPushSuccess?: () => void;
}

interface CloudIndicatorProps {
  /** Minimal icon-only variant for the top toolbar. */
  variant?: 'icon' | 'full';
}

// ── Helper: progress text ────────────────────────────────────────────

const PROGRESS_LABELS: Record<ImportProgressPhase, string> = {
  parsing: 'Parsing…',
  validating: 'Validating…',
  writingMedia: 'Importing media…',
  writingCourse: 'Writing course…',
  done: 'Done!',
};

function StatusIcon({ status }: { status: SyncStatus }) {
  switch (status) {
    case 'pushing':
      return <CloudUpload className="w-4 h-4 animate-pulse text-blue-500" />;
    case 'pulling':
      return <CloudDownload className="w-4 h-4 animate-pulse text-green-500" />;
    case 'listing':
      return <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />;
    default:
      return null;
  }
}

// ── CloudIndicator (icon-only for top toolbar) ───────────────────────

export function CloudIndicator({ variant = 'icon' }: CloudIndicatorProps) {
  const { t } = useI18n();
  const { enabled, ready, user, status, checkHealth } = useCloudSync();

  useEffect(() => {
    if (enabled) checkHealth();
  }, [enabled, checkHealth]);

  if (!enabled) return null;

  const connected = ready && user !== null;
  const tooltip = connected
    ? `Cloud Sync — ${user?.displayName ?? user?.id ?? ''}`
    : ready
      ? 'Cloud Sync — disconnected'
      : 'Cloud Sync — unavailable';

  return (
    <div className="relative group">
      <button
        onClick={() => { if (!ready) checkHealth(); }}
        className={cn(
          'p-2 rounded-full transition-all',
          connected
            ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
            : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700',
        )}
        title={tooltip}
        aria-label={tooltip}
      >
        {status !== 'idle' ? (
          <StatusIcon status={status} />
        ) : connected ? (
          <Cloud className="w-4 h-4" />
        ) : (
          <CloudOff className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

// ── CloudSyncPanel (full section for home page) ──────────────────────

export function CloudSyncPanel({ onPullSuccess, onPushSuccess }: CloudSyncPanelProps) {
  const { t } = useI18n();
  const cloud = useCloudSync();
  const [inviteCode, setInviteCode] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    cloud.checkHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cloud.enabled) return null;
  if (!cloud.ready) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-gray-400">
        <CloudOff className="w-4 h-4" />
        <span>Cloud sync server not available</span>
        <button
          onClick={() => cloud.checkHealth()}
          className="text-blue-500 hover:underline ml-1"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Not logged in → show login form ──────────────────────────────
  if (!cloud.user) {
    const handleLogin = async () => {
      if (!inviteCode.trim()) return;
      setLoginBusy(true);
      try {
        await cloud.login(inviteCode.trim());
        toast.success('Cloud sync connected');
        setInviteCode('');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Login failed';
        toast.error(msg);
      } finally {
        setLoginBusy(false);
      }
    };

    return (
      <div className="mt-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <Cloud className="w-5 h-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Cloud Sync
          </h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Enter an invite code to sync your classrooms across browsers.
        </p>
        <div className="flex gap-2">
          <Input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="Invite code"
            className="h-9 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          <Button
            onClick={handleLogin}
            disabled={loginBusy || !inviteCode.trim()}
            size="sm"
            className="shrink-0"
          >
            {loginBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogIn className="w-3.5 h-3.5" />
            )}
            <span className="ml-1.5">Login</span>
          </Button>
        </div>
      </div>
    );
  }

  // ── Logged in → show status + classroom list ─────────────────────
  const handlePush = async () => {
    const result = await cloud.pushCurrent();
    if (result) {
      toast.success(`Pushed "${result.title}"`);
      await cloud.list();
      onPushSuccess?.();
    } else {
      toast.error('Push failed — is a classroom open?');
    }
  };

  const handlePull = async (id: string) => {
    const stageId = await cloud.pullById(id);
    if (stageId) {
      toast.success('Classroom imported locally');
      await cloud.list();
      onPullSuccess?.();
    } else {
      toast.error('Pull failed');
    }
  };

  const handleDelete = async (id: string, title: string) => {
    const ok = await cloud.deleteRemote(id);
    if (ok) {
      toast.success(`Deleted "${title}" from cloud`);
    }
  };

  return (
    <div className="mt-8 rounded-xl border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-950/20 backdrop-blur-sm p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cloud className="w-5 h-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Cloud Sync
          </h3>
          <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            {cloud.user.displayName ?? cloud.user.id}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePush}
            disabled={cloud.status !== 'idle'}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
            title="Push current classroom to cloud"
          >
            {cloud.status === 'pushing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>Push</span>
          </button>
          <button
            onClick={() => cloud.list()}
            disabled={cloud.status !== 'idle'}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            title="Refresh cloud classroom list"
          >
            <RefreshCw
              className={cn(
                'w-3.5 h-3.5',
                cloud.status === 'listing' && 'animate-spin',
              )}
            />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => cloud.logout()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Disconnect cloud sync"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Pull progress */}
      {cloud.importPhase && cloud.importPhase !== 'done' && (
        <div className="flex items-center gap-2 mb-3 text-xs text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{PROGRESS_LABELS[cloud.importPhase]}</span>
        </div>
      )}

      {/* Classroom list */}
      {cloud.classrooms.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          No classrooms on the server yet. Open a classroom and click Push.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {cloud.classrooms.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                  {c.title}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  {(c.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{' '}
                  {new Date(c.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <button
                  onClick={() => handlePull(c.id)}
                  disabled={cloud.status !== 'idle'}
                  className="p-1.5 rounded-md text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                  title={`Download "${c.title}"`}
                >
                  <CloudDownload className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(c.id, c.title)}
                  disabled={cloud.status !== 'idle'}
                  className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  title={`Delete "${c.title}" from cloud`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
