export type Streamer = {
  id: string;
  login: string;
  displayName: string;
  lastStatus: "unknown" | "online" | "offline";
  lastCheckedAt: string | null;
  _count?: { sessions: number };
};

export type StreamSession = {
  id: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "live" | "ended";
  streamer: { login: string; displayName: string };
  _count?: { posts: number };
};

export type Asset = {
  id: string;
  originalUrl: string;
  normalizedUrl: string;
  sha256: string | null;
  s3Key: string | null;
  publicUrl: string | null;
  mimeType: string | null;
  byteSize: string | null;
  mediaType: "image" | "video" | "other";
  status: string;
  visibility: string;
  posts?: Array<{
    authorName: string;
    postedAt: string;
    streamSession: { streamer: { displayName: string; login: string }; startedAt: string };
  }>;
};

export type TimelinePost = {
  id: string;
  authorName: string;
  messageText: string;
  originalUrl: string;
  postedAt: string;
  asset: Asset;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const api = {
  streamers: () => request<Streamer[]>("/streamers"),
  streams: (streamerId?: string) => request<StreamSession[]>(`/streams${streamerId ? `?streamerId=${streamerId}` : ""}`),
  timeline: (streamId: string, type?: string) => request<TimelinePost[]>(`/streams/${streamId}/timeline${type ? `?type=${type}` : ""}`),
  login: (username: string, password: string) => request<{ ok: true }>("/admin/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  dashboard: () => request<AdminDashboard>("/admin/dashboard"),
  assets: () => request<Asset[]>("/admin/assets"),
  failedJobs: () => request<DownloadJob[]>("/admin/jobs/failed"),
  hideAsset: (id: string) => request<Asset>(`/admin/assets/${id}/hide`, { method: "POST" }),
  restoreAsset: (id: string) => request<Asset>(`/admin/assets/${id}/restore`, { method: "POST" }),
  deleteAsset: (id: string, reason: string) => request<Asset>(`/admin/assets/${id}/delete`, { method: "POST", body: JSON.stringify({ reason }) }),
  retryJob: (id: string) => request<DownloadJob>(`/admin/jobs/${id}/retry`, { method: "POST" }),
};

export type AdminDashboard = {
  streamers: Streamer[];
  activeSessions: number;
  failedJobs: number;
  storedAssets: number;
  blockedPosts: number;
  bytesToday: string;
  recentErrors: DownloadJob[];
};

export type DownloadJob = {
  id: string;
  url: string;
  status: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};
