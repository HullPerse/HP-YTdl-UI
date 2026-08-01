export type MenuTab = "video" | "playlist" | "queue";
export type SettingsTab = "general" | "playlist" | "package";

export interface SearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
  url: string;
}

export interface ParsedTitle {
  artist: string;
  title: string;
  misc: string;
  filename: string;
  source_title: string;
}

export interface MetadataResult extends ParsedTitle {
  duration: number | null;
  channel: string;
  id: string;
  thumbnail: string;
}

export interface PlaylistInfo {
  name: string;
  tracks: string[];
  count: number;
}

export interface PlaylistImportResult {
  name: string;
  count: number;
  path: string;
}

export interface DownloadRequest {
  url: string;
  filename: string;
  fmt: string;
  quality: string;
  playlist: string;
  include_thumbnail: boolean;
}

export interface QueueAddRequest {
  url: string;
  filename: string;
  fmt: string;
  quality: string;
  playlist: string;
  output_dir: string;
  include_thumbnail: boolean;
}

export interface QueueReorderRequest {
  id: string;
  new_index: number;
}

export interface QueueConfigRequest {
  max_concurrent: number;
}

export interface QueueResolveRequest {
  action: "overwrite" | "skip";
}

export interface PlaylistImportBody {
  url: string;
  name: string;
}

export interface PlaylistCheckBody {
  tracks: string[];
  template: string;
}

export interface CookiesBody {
  content: string;
}

export interface PlaylistCleanupOptions {
  removeHeaders?: boolean;
  removeIndexes?: boolean;
  removeUrls?: boolean;
  removeTimestamps?: boolean;
  normalizeTitles?: boolean;
  dedupe?: boolean;
}

export interface PlaylistCleanupBody {
  options?: PlaylistCleanupOptions;
  dry_run?: boolean;
}

export interface PlaylistRenameBody {
  new_name: string;
}

export interface PlaylistCompressBody {
  indices?: number[];
  bitrate?: string;
}

export interface PlaylistNormalizeBody {
  indices?: number[];
}

export interface PlaylistResyncBody {
  url: string;
}

export interface AudioProcessResult {
  index?: number;
  file?: string;
  ok: boolean;
  error?: string;
}

export interface PlaylistCleanupResult {
  before: number;
  after: number;
  removed: number;
  changed: number;
  removedLines: string[];
  preview: string[];
  extension?: string;
}

export interface QueueItemData {
  id: string;
  url: string;
  filename: string;
  fmt: string;
  quality: string;
  playlist: string;
  output_dir: string;
  include_thumbnail: boolean;
  status: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed: number;
  eta: number;
  error: string;
  output_path: string;
}

export interface DownloadProgress {
  status: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed: number;
  eta: number;
  percent: string;
}

export interface CookieDetectResult {
  found: boolean;
  total: number;
  detail: string;
  per_browser: Record<string, string>;
  youtube_cookies?: number;
  auth_cookies?: number;
  missing_auth?: string[];
  has_all_auth?: boolean;
  source?: string;
}

export interface CookieInspectResult {
  exists: boolean;
  total_cookies?: number;
  domains?: string[];
  auth_cookies_present?: string[];
  has_all_auth?: boolean;
}

export interface YtdlpVersionResult {
  version: string;
  latest: string;
  available: boolean;
  frozen: boolean;
  update_available: boolean;
}

export interface YtdlpUpdateResult {
  updated: boolean;
  version?: string;
  frozen?: boolean;
  error?: string;
  output?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

export type Listener = () => void;
