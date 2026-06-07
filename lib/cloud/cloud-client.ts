/**
 * Cloud sync — browser-side API client.
 *
 * Thin fetch wrapper around the `/api/cloud/*` endpoints.
 * All responses are typed.  Auth cookie is sent automatically.
 */

// ── Types (mirror what the server sends) ─────────────────────────────

export interface CloudUserDto {
  id: string;
  displayName: string | null;
  createdAt: number;
}

export interface HealthDto {
  ok: boolean;
  inviteCodeRequired: boolean;
  inviteCodesConfigured: boolean;
  maxUploadBytes: number;
  sessionMaxAgeSeconds: number;
}

export interface ClassroomDto {
  id: string;
  title: string;
  description: string | null;
  sizeBytes: number;
  sha256: string;
  createdAt: number;
  updatedAt: number;
}

// ── Internal helpers ─────────────────────────────────────────────────

class CloudApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "CloudApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
  });
  if (!res.ok) {
    let code = "unknown";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // ignore parse errors
    }
    throw new CloudApiError(res.status, code, message);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Public client ────────────────────────────────────────────────────

export const cloudApi = {
  health(): Promise<HealthDto> {
    return request<HealthDto>("/api/cloud/health");
  },

  login(inviteCode: string, displayName?: string) {
    return request<{ user: CloudUserDto; expiresAt: number }>(
      "/api/cloud/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ inviteCode, displayName }),
      },
    );
  },

  logout() {
    return request<{ ok: boolean }>("/api/cloud/auth/logout", {
      method: "POST",
    });
  },

  me(): Promise<{ user: CloudUserDto | null }> {
    return request<{ user: CloudUserDto | null }>("/api/cloud/auth/me");
  },

  listClassrooms(): Promise<{ classrooms: ClassroomDto[] }> {
    return request<{ classrooms: ClassroomDto[] }>("/api/cloud/classrooms");
  },

  getClassroomMeta(id: string): Promise<{ classroom: ClassroomDto }> {
    return request<{ classroom: ClassroomDto }>(
      `/api/cloud/classrooms/${encodeURIComponent(id)}?meta=1`,
    );
  },

  /** Upload a `.maic.zip` blob. Returns null on 413. */
  async uploadClassroom(
    blob: Blob,
    replaceId?: string,
  ): Promise<{ classroom: ClassroomDto } | "too_large"> {
    // Prefer raw body (simpler, works with both fetch and service workers).
    // For large files we use FormData to avoid loading everything into memory
    // twice on the server — but for now raw body is fine since the server accepts both.
    const url = replaceId
      ? `/api/cloud/classrooms?replaceId=${encodeURIComponent(replaceId)}`
      : "/api/cloud/classrooms";
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/zip" },
      body: blob,
    });
    if (res.status === 413) return "too_large";
    if (!res.ok) {
      let code = "unknown";
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body.error?.code) code = body.error.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // ignore
      }
      throw new CloudApiError(res.status, code, message);
    }
    return (await res.json()) as { classroom: ClassroomDto };
  },

  /** Download a `.maic.zip` blob as an ArrayBuffer. Returns the raw response for metadata too. */
  async downloadClassroom(id: string): Promise<{
    data: ArrayBuffer;
    filename: string;
    sha256: string;
    updatedAt: number;
  } | null> {
    const res = await fetch(
      `/api/cloud/classrooms/${encodeURIComponent(id)}`,
      { credentials: "include" },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      let code = "unknown";
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body.error?.code) code = body.error.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // ignore
      }
      throw new CloudApiError(res.status, code, message);
    }
    const data = await res.arrayBuffer();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    // Prefer filename* (RFC 5987, supports non-ASCII) over plain filename.
    const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const filename = starMatch
      ? decodeURIComponent(starMatch[1])
      : disposition.match(/filename="([^"]*)"/)?.[1] ?? "classroom.maic.zip";
    return {
      data,
      filename,
      updatedAt: Number(res.headers.get("X-Classroom-Updated-At") ?? 0),
    };
  },

  deleteClassroom(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(
      `/api/cloud/classrooms/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },
};