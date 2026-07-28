interface SearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
}

interface MetadataFields {
  artist: string;
  title: string;
  misc: string;
  channel: string;
  id: string;
  source_title: string;
}

interface Metadata extends MetadataFields {
  duration?: number;
  filename?: string;
}

interface PlaylistInfo {
  name: string;
  tracks: string[];
  count: number;
}

interface QueueItemData {
  id: string;
  url: string;
  filename: string;
  fmt: string;
  quality: string;
  playlist: string;
  output_dir: string;
  status: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed: number;
  eta: number;
  error: string;
  output_path: string;
}

interface YtdlpVersionInfo {
  version: string;
  latest: string;
  available: boolean;
  frozen: boolean;
  update_available: boolean;
}

interface SelectedVideo {
  id: string;
  title: string;
  url: string;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $input = (id: string) => document.getElementById(id) as HTMLInputElement;
const $btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
const $sel = (id: string) => document.getElementById(id) as HTMLSelectElement;

const MANUAL_INPUT = $input("manual-query");
const PLAYLIST_INPUT = $input("playlist-query");
const RESULTS = $("results");
const PREVIEW = $("preview");
const ERROR = $("error");
const LOADING = $("loading");
const LOADING_TEXT = $("loading-text");
const SETTINGS_PANEL = $("settings-panel");
const FETCH_BTN = $btn("btn-manual-search");
const QUALITY_CHIPS = $("quality-chips");
const DL_BTN = $btn("btn-dl");
const DL_BTN_LABEL = $("dl-btn-label");
const DL_PROGRESS_FILL = $("dl-progress-fill");
const QUEUE_ITEMS = $("queue-items");
const QUEUE_BADGE = $("queue-badge");
const QUEUE_STATS = $("queue-stats");
const MODAL = $("modal");
const MODAL_TEXT = $("modal-text");
const MODAL_TITLE = $("modal-title");
const CONFLICT_MODAL = $("conflict-modal");
const CONFLICT_MODAL_TEXT = $("conflict-modal-text");

let selectedVideo: SelectedVideo | null = null;
let currentFilename = "";
let currentPlaylistName = "";
let playlistTracks: string[] = [];
let playlistIndex = -1;
let progressEventSource: EventSource | null = null;
let queueEventSource: EventSource | null = null;
let selectedFormat = "audio";
let selectedQuality = localStorage.getItem("defaultQuality") || "720";
let dlSuccessTimer: ReturnType<typeof setTimeout> | null = null;
let cachedMetadataFields: MetadataFields | null = null;
let queueItems: QueueItemData[] = [];
let modalResolve: ((v: boolean) => void) | null = null;
let dnldItemId: string | null = null;
let conflictResolving = false;

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60),
    s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function urlHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h << 5) - h + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}

function applyFilenameTemplate(
  fields: MetadataFields & {
    ext?: string;
    playlist?: string;
    quality?: string;
  },
  template: string,
): string {
  let name = template;
  name = name.replace(/{artist}/g, fields.artist || "");
  name = name.replace(/{title}/g, fields.title || "");
  name = name.replace(/{misc}/g, fields.misc ? ` [${fields.misc}]` : "");
  name = name.replace(/{channel}/g, fields.channel || "");
  name = name.replace(/{id}/g, fields.id || "");
  name = name.replace(/{ext}/g, fields.ext || "mp3");
  name = name.replace(/{playlist}/g, fields.playlist || "");
  name = name.replace(/{quality}/g, fields.quality || "720");
  name = name.replace(/{source_title}/g, fields.source_title || "");
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

function updateQualityVisibility(): void {
  QUALITY_CHIPS.style.display = selectedFormat === "video" ? "flex" : "none";
}

function resetDownloadBtn(): void {
  DL_BTN.classList.remove("success");
  DL_BTN.disabled = false;
  DL_PROGRESS_FILL.style.width = "0%";
  DL_BTN_LABEL.textContent = "Download";
  if (dlSuccessTimer) {
    clearTimeout(dlSuccessTimer);
    dlSuccessTimer = null;
  }
}

function reapplyTemplate(): void {
  if (!cachedMetadataFields) return;
  const tpl =
    localStorage.getItem("filenameTemplate") || "{artist} - {title}{misc}";
  const ext = selectedFormat === "audio" ? "mp3" : "mp4";
  const fields = {
    ...cachedMetadataFields,
    ext,
    playlist: currentPlaylistName || "",
    quality: selectedQuality,
  };
  currentFilename = applyFilenameTemplate(fields, tpl);
  const el = $("preview-title");
  if (el) el.textContent = currentFilename;
}

function setFetchLoading(v: boolean): void {
  if (v) {
    FETCH_BTN.disabled = true;
    FETCH_BTN.innerHTML =
      '<svg class="spinner-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg><span>Fetching Metadata...</span>';
  } else {
    FETCH_BTN.disabled = false;
    FETCH_BTN.innerHTML = '<span class="btn-text">Fetch Media</span>';
  }
}

function clearAll(): void {
  currentFilename = "";
  RESULTS.style.display = "none";
  PREVIEW.style.display = "none";
  ERROR.style.display = "none";
  LOADING.style.display = "none";
  stopPreviewVideo();
  selectedVideo = null;
  cachedMetadataFields = null;
  const r = $("download-result");
  if (r) r.style.display = "none";
  resetDownloadBtn();
  updateQualityVisibility();
  if (progressEventSource) {
    progressEventSource.close();
    progressEventSource = null;
  }
}

function showError(msg: string): void {
  ERROR.textContent = msg;
  ERROR.style.display = "block";
  setTimeout(() => {
    ERROR.style.display = "none";
  }, 8000);
}

function showLoading(text?: string): void {
  LOADING_TEXT.textContent = text || "Searching...";
  LOADING.style.display = "flex";
}

function hideLoading(): void {
  LOADING.style.display = "none";
}

function showModal(title: string, text: string): Promise<boolean> {
  MODAL_TITLE.textContent = title;
  MODAL_TEXT.textContent = text;
  MODAL.style.display = "flex";
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function showConflictModal(text: string): Promise<"overwrite" | "skip" | null> {
  CONFLICT_MODAL_TEXT.textContent = text;
  CONFLICT_MODAL.style.display = "flex";
  return new Promise((resolve) => {
    const cleanup = () => {
      CONFLICT_MODAL.style.display = "none";
      $btn("btn-conflict-skip").onclick = null;
      $btn("btn-conflict-overwrite").onclick = null;
      $btn("btn-conflict-cancel").onclick = null;
      $btn("btn-conflict-close").onclick = null;
    };
    $btn("btn-conflict-skip").onclick = () => { cleanup(); resolve("skip"); };
    $btn("btn-conflict-overwrite").onclick = () => { cleanup(); resolve("overwrite"); };
    $btn("btn-conflict-cancel").onclick = () => { cleanup(); resolve(null); };
    $btn("btn-conflict-close").onclick = () => { cleanup(); resolve(null); };
  });
}

const RECENT_KEY = "recentSearches",
  RECENT_MAX = 5;
const recentEl = $("recent-searches");

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveRecent(arr: string[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
}
function addRecent(q: string): void {
  const arr = getRecent().filter((x) => x !== q);
  arr.unshift(q);
  saveRecent(arr.slice(0, RECENT_MAX));
}
function renderRecent(): void {
  const arr = getRecent();
  if (!arr.length) {
    recentEl.classList.remove("visible");
    return;
  }
  recentEl.innerHTML = arr
    .map(
      (q, i) =>
        `<div class="recent-item" data-idx="${i}"><span class="recent-item-text">${escapeHtml(q)}</span><button class="recent-item-remove" data-idx="${i}">&times;</button></div>`,
    )
    .join("");
  recentEl.querySelectorAll(".recent-item-text").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(
        (el.parentElement as HTMLElement).dataset.idx || "",
        10,
      );
      MANUAL_INPUT.value = getRecent()[idx] || "";
      recentEl.classList.remove("visible");
      $btn("btn-manual-search").click();
    });
  });
  recentEl.querySelectorAll(".recent-item-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "", 10);
      const a = getRecent();
      a.splice(idx, 1);
      saveRecent(a);
      renderRecent();
    });
  });
  recentEl.classList.add("visible");
}

async function search(query: string, mode: string): Promise<void> {
  clearAll();
  setFetchLoading(true);
  currentFilename = query;
  if (mode === "manual") addRecent(query);
  try {
    const res = await fetch(
      "/api/search?query=" + encodeURIComponent(query) + "&max_results=8",
    );
    if (!res.ok) {
      showError("Search failed");
      setFetchLoading(false);
      return;
    }
    const data: { results?: SearchResult[] } = await res.json();
    setFetchLoading(false);
    if (!data.results?.length) {
      showError("No results found");
      return;
    }
    renderResults(data.results, mode);
  } catch (err: unknown) {
    setFetchLoading(false);
    showError("Error: " + (err instanceof Error ? err.message : String(err)));
  }
}

function renderResults(results: SearchResult[], mode: string): void {
  RESULTS.innerHTML = "";
  RESULTS.style.display = "grid";
  results.forEach((r) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-thumb">
        <img src="${r.thumbnail}" loading="lazy" alt="">
        <button class="btn-thumb-dl" data-url="${r.thumbnail}" data-id="${r.id}" title="Download thumbnail"></button>
        ${r.duration ? `<span class="duration">${formatDuration(r.duration)}</span>` : ""}
      </div>
      <div class="result-info">
        <div class="result-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div>
        <div class="result-channel">${escapeHtml(r.channel)}</div>
      </div>
      <div class="result-actions">
        <button class="btn-small btn-select" data-id="${r.id}" data-title="${escapeHtml(r.title)}" data-url="${r.url}">Select</button>
      </div>
    `;
    RESULTS.appendChild(card);
    card
      .querySelector(".btn-select")
      ?.addEventListener("click", () =>
        showPreview(r.id, r.title, r.url, mode),
      );
    card
      .querySelector(".btn-thumb-dl")
      ?.addEventListener("click", () => dlThumb(r.thumbnail, r.id));
  });
}

async function dlThumb(url: string, id: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.jpg`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    showError("Failed to download thumbnail");
  }
}

function stopPreviewVideo(): void {
  const video = document.getElementById("preview-video") as HTMLVideoElement | null;
  if (video) { video.pause(); video.style.display = "none"; video.removeAttribute("src"); }
  const thumb = document.getElementById("preview-thumb") as HTMLImageElement | null;
  if (thumb) thumb.style.display = "";
  const overlay = document.getElementById("preview-play-overlay");
  if (overlay) overlay.style.display = "flex";
}

async function playPreviewVideo(videoId: string): Promise<void> {
  const thumb = document.getElementById("preview-thumb") as HTMLImageElement | null;
  const overlay = document.getElementById("preview-play-overlay");
  const video = document.getElementById("preview-video") as HTMLVideoElement | null;
  if (!video) return;
  try {
    const res = await fetch("/api/stream/" + encodeURIComponent(videoId) + "?quality=360");
    if (!res.ok) { showError("Failed to load video stream"); return; }
    const data: { url: string } = await res.json();
    if (thumb) thumb.style.display = "none";
    if (overlay) overlay.style.display = "none";
    video.src = data.url;
    video.style.display = "";
    await video.play();
  } catch {
    showError("Video playback failed");
  }
}

function showPreview(
  videoId: string,
  title: string,
  url: string,
  mode: string,
): void {
  selectedVideo = { id: videoId, title, url };
  cachedMetadataFields = null;
  dnldItemId = null;
  stopPreviewVideo();
  const thumb = document.getElementById("preview-thumb") as HTMLImageElement | null;
  if (thumb) thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const ytLink = document.getElementById(
    "preview-yt-link",
  ) as HTMLAnchorElement | null;
  if (ytLink) ytLink.href = `https://www.youtube.com/watch?v=${videoId}`;
  resetDownloadBtn();
  updateQualityVisibility();
  PREVIEW.style.display = "flex";
  const titleEl = $("preview-title");
  if (!titleEl) return;
  // Apply template immediately with raw title data (before metadata arrives)
  const tpl = localStorage.getItem("filenameTemplate") || "{artist} - {title}{misc}";
  const sepIdx = title.indexOf(" - ");
  const fields = {
    artist: sepIdx > 0 ? title.substring(0, sepIdx).trim() : "",
    title: sepIdx > 0 ? title.substring(sepIdx + 3).trim() : title,
    misc: "",
    channel: "",
    id: videoId,
    source_title: title,
    ext: selectedFormat === "audio" ? "mp3" : "mp4",
    playlist: currentPlaylistName || "",
    quality: selectedQuality,
  };
  currentFilename = applyFilenameTemplate(fields, tpl);
  titleEl.textContent = currentFilename;
  // Then fetch metadata for better template reapplication
  fetch("/api/metadata?url=" + encodeURIComponent(url))
    .then((r) => r.json())
    .then((data: Metadata) => {
      cachedMetadataFields = {
        artist: data.artist || "",
        title: data.title || "",
        misc: data.misc || "",
        channel: data.channel || "",
        id: data.id || "",
        source_title: data.source_title || "",
      };
      reapplyTemplate();
    })
    .catch(() => {});
}

function clearPlaylistState(): void {
  playlistTracks = [];
  playlistIndex = -1;
  currentPlaylistName = "";
  const sel = $sel("playlist-select");
  if (sel) sel.value = "";
  $("playlist-info").style.display = "none";
  PREVIEW.style.display = "none";
  clearAll();
}

function showPlaylistTrack(): void {
  if (playlistIndex < 0 || playlistIndex >= playlistTracks.length) {
    clearPlaylistState();
    const te = $("track-progress");
    if (te) te.textContent = "All done!";
    return;
  }
  const te = $("track-progress");
  if (te)
    te.textContent = `Track ${playlistIndex + 1} of ${playlistTracks.length}`;
  PLAYLIST_INPUT.value = playlistTracks[playlistIndex];
  clearAll();
  $btn("btn-playlist-search").click();
}

function updateQueueBadge(): void {
  const active = queueItems.filter(
    (it) => it.status === "waiting" || it.status === "downloading",
  ).length;
  if (active > 0) {
    QUEUE_BADGE.textContent = `(${active})`;
    QUEUE_BADGE.style.display = "";
  } else {
    QUEUE_BADGE.style.display = "none";
  }
  const completed = queueItems.filter(
    (it) => it.status === "completed" || it.status === "failed",
  ).length;
  const btn = $("btn-queue-clear");
  if (btn) btn.style.display = completed > 0 ? "" : "none";
  const stats = $("queue-stats");
  if (stats)
    stats.textContent = `${queueItems.length} item(s) — ${active} active`;
}

function renderQueue(): void {
  if (!QUEUE_ITEMS) return;
  QUEUE_ITEMS.innerHTML = queueItems
    .map((it, idx) => {
      const pct = Math.min(it.progress, 100);
      const speed = it.speed
        ? (it.speed / 1024 / 1024).toFixed(1) + " MB/s"
        : "";
      const eta = it.eta ? it.eta + "s" : "";
      const etaStr = [speed, eta].filter(Boolean).join(" ");
      const icon =
        it.status === "downloading"
          ? "&#9654;"
          : it.status === "completed"
            ? "&#10003;"
            : it.status === "failed"
              ? "&#10007;"
              : it.status === "cancelled"
                ? "&#8211;"
                : it.status === "conflict"
                  ? "&#9888;"
                  : "&#9632;";
      const canMoveUp = idx > 0 && it.status === "waiting";
      const canMoveDown =
        idx < queueItems.length - 1 && it.status === "waiting";
      const canCancel = it.status === "waiting" || it.status === "downloading";
      return `<div class="queue-item ${it.status}" data-id="${it.id}">
      <div class="queue-item-order">
        ${canMoveUp ? `<button class="btn-small queue-up" data-id="${it.id}">&#9650;</button>` : ""}
        ${canMoveDown ? `<button class="btn-small queue-down" data-id="${it.id}">&#9660;</button>` : ""}
      </div>
      <div class="queue-item-info">
        <div class="queue-item-name">${escapeHtml(it.filename)}.${it.fmt}</div>
        <div class="queue-item-status">${icon} ${it.status}${it.status === "failed" ? ": " + escapeHtml(it.error) : ""}</div>
        ${
          it.status === "downloading"
            ? `<div class="queue-item-bar"><div class="queue-item-fill" style="width:${pct}%"></div></div>
        <div class="queue-item-meta">${Math.round(pct)}%${etaStr ? " — " + etaStr : ""}</div>`
            : ""
        }
      </div>
      <div class="queue-item-actions">
        ${canCancel ? `<button class="btn-small queue-cancel" data-id="${it.id}">&#10005;</button>` : ""}
      </div>
    </div>`;
    })
    .join("");
  QUEUE_ITEMS.querySelectorAll(".queue-up").forEach((b) =>
    b.addEventListener("click", () =>
      queueReorder((b as HTMLElement).dataset.id || "", -1),
    ),
  );
  QUEUE_ITEMS.querySelectorAll(".queue-down").forEach((b) =>
    b.addEventListener("click", () =>
      queueReorder((b as HTMLElement).dataset.id || "", 1),
    ),
  );
  QUEUE_ITEMS.querySelectorAll(".queue-cancel").forEach((b) =>
    b.addEventListener("click", () =>
      queueRemove((b as HTMLElement).dataset.id || ""),
    ),
  );
  updateQueueBadge();
  const skipBtn = $btn("btn-playlist-skip");
  if (skipBtn) skipBtn.style.display = currentPlaylistName ? "" : "none";
}

async function queueReorder(id: string, dir: number): Promise<void> {
  const idx = queueItems.findIndex((it) => it.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= queueItems.length) return;
  await fetch("/api/queue/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, new_index: newIdx }),
  });
}

async function queueRemove(id: string): Promise<void> {
  await fetch("/api/queue/" + encodeURIComponent(id), { method: "DELETE" });
}

async function queueSkip(id: string): Promise<void> {
  await fetch("/api/queue/skip/" + encodeURIComponent(id), { method: "POST" });
}

async function resolveConflict(id: string, action: string): Promise<void> {
  await fetch("/api/queue/resolve/" + encodeURIComponent(id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

function connectQueueSSE(): void {
  if (queueEventSource) {
    queueEventSource.close();
  }
  queueEventSource = new EventSource("/api/queue/progress");
  queueEventSource.onmessage = (e) => {
    try {
      queueItems = JSON.parse(e.data);
      renderQueue();
      if (dnldItemId) {
        const myItem = queueItems.find((it) => it.id === dnldItemId);
        if (myItem) {
          if (myItem.status === "downloading") {
            const pct = Math.min(myItem.progress, 100);
            DL_PROGRESS_FILL.style.width = pct + "%";
            const speed = myItem.speed
              ? (myItem.speed / 1024 / 1024).toFixed(1) + " MB/s"
              : "";
            const eta = myItem.eta ? myItem.eta + "s" : "";
            const etaStr = [speed, eta].filter(Boolean).join(" ");
            DL_BTN_LABEL.textContent =
              Math.round(pct) + "%" + (etaStr ? " — " + etaStr : "");
          } else if (myItem.status === "completed") {
            dnldItemId = null;
            DL_PROGRESS_FILL.style.width = "100%";
            DL_BTN_LABEL.textContent = "";
            DL_BTN.classList.add("success");
            const filename = encodeURIComponent(
              myItem.filename + "." + myItem.fmt,
            );
            const r = $("download-result");
            if (r) {
              r.innerHTML = `<span class="success-icon">&#10003;</span> <a href="/api/download/${filename}" download="${myItem.filename}.${myItem.fmt}">${myItem.filename}.${myItem.fmt}</a>`;
              r.style.display = "flex";
            }
            if (dlSuccessTimer) clearTimeout(dlSuccessTimer);
            dlSuccessTimer = setTimeout(() => {
              DL_BTN.classList.remove("success");
              DL_BTN.disabled = false;
              DL_PROGRESS_FILL.style.width = "0%";
              DL_BTN_LABEL.textContent = "Download";
            }, 1500);
            if (playlistTracks.length > 0) {
              setTimeout(() => {
                playlistIndex++;
                showPlaylistTrack();
              }, 1500);
            }
          } else if (myItem.status === "conflict" && !conflictResolving) {
            conflictResolving = true;
            const fname = myItem.filename + "." + myItem.fmt;
            showConflictModal(
              `"${fname}" already exists in downloads directory.\n\nOverwrite the existing file or skip this track?`,
            ).then(async (action) => {
              if (action === "overwrite") {
                DL_BTN_LABEL.textContent = "Overwriting...";
                await resolveConflict(myItem.id, "overwrite");
              } else if (action === "skip") {
                await resolveConflict(myItem.id, "skip");
              } else {
                resetDownloadBtn();
              }
              conflictResolving = false;
            });
          } else if (myItem.status === "failed") {
            showError("Download failed: " + myItem.error);
            resetDownloadBtn();
          }
        }
      }
    } catch {}
  };
}

async function download(): Promise<void> {
  if (!selectedVideo) {
    showError("Select a video first");
    return;
  }
  DL_BTN.disabled = true;
  DL_BTN_LABEL.textContent = "Adding to queue...";
  const r = $("download-result");
  if (r) r.style.display = "none";
  try {
    const outputDir = localStorage.getItem("outputDir") || "";
    const chkThumb = document.getElementById("chk-include-thumbnail") as HTMLInputElement | null;
    const includeThumbnail = chkThumb ? chkThumb.checked : true;
    const res = await fetch("/api/queue/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: selectedVideo.url,
        filename: currentFilename,
        fmt: selectedFormat === "audio" ? "mp3" : "mp4",
        quality: selectedQuality,
        playlist: currentPlaylistName,
        output_dir: outputDir,
        include_thumbnail: includeThumbnail,
      }),
    });
    const data: { item_id: string } = await res.json();
    dnldItemId = data.item_id;
    DL_BTN_LABEL.textContent = "Queued";
    if (!queueEventSource) connectQueueSSE();
  } catch (err: unknown) {
    resetDownloadBtn();
    showError(
      "Queue error: " + (err instanceof Error ? err.message : String(err)),
    );
  }
}

async function downloadAllPlaylist(): Promise<void> {
  if (!playlistTracks.length) return;
  const confirmed = await showModal(
    "Download All",
    "This will search each track individually and add the first result to the queue. Results may not match exactly. Proceed?",
  );
  MODAL.style.display = "none";
  if (!confirmed) return;
  for (let i = 0; i < playlistTracks.length; i++) {
    const track = playlistTracks[i];
    try {
      const res = await fetch(
        "/api/search?query=" + encodeURIComponent(track) + "&max_results=1",
      );
      const data: { results?: SearchResult[] } = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0];
        const outputDir = localStorage.getItem("outputDir") || "";
        const tpl = localStorage.getItem("filenameTemplate") || "{artist} - {title}{misc}";
        const rawTitle = r.title;
        const sepIdx = rawTitle.indexOf(" - ");
        const parsedFilename = applyFilenameTemplate(
          {
            artist: sepIdx > 0 ? rawTitle.substring(0, sepIdx).trim() : "",
            title: sepIdx > 0 ? rawTitle.substring(sepIdx + 3).trim() : rawTitle,
            misc: "",
            channel: "",
            id: r.id,
            source_title: rawTitle,
          },
          tpl,
        );
        await fetch("/api/queue/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: r.url,
            filename: parsedFilename || r.title,
            fmt: selectedFormat === "audio" ? "mp3" : "mp4",
            quality: selectedQuality,
            playlist: currentPlaylistName,
            output_dir: outputDir,
          }),
        });
      }
    } catch {}
    if (i < playlistTracks.length - 1)
      await new Promise((r) => setTimeout(r, 500));
  }
  showError("Added " + playlistTracks.length + " items to queue");
}

const savedQuality = localStorage.getItem("defaultQuality");
if (savedQuality) {
  selectedQuality = savedQuality;
  const qs = $sel("default-quality");
  if (qs) qs.value = savedQuality;
}

const savedOutputDir = localStorage.getItem("outputDir");
if (savedOutputDir) {
  const od = $input("output-dir");
  if (od) od.value = savedOutputDir;
}

const savedConcurrent = localStorage.getItem("maxConcurrent");
if (savedConcurrent) {
  const mc = $input("max-concurrent");
  if (mc) mc.value = savedConcurrent;
}

async function loadPlaylistSelect(nameToSelect?: string): Promise<void> {
  const res = await fetch("/api/playlists");
  const playlists: PlaylistInfo[] = await res.json();
  const sel = $sel("playlist-select");
  const renameSel = $sel("rename-playlist-select");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a playlist —</option>';
  if (renameSel) renameSel.innerHTML = '<option value="">— Select —</option>';
  playlists.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = `${p.name} (${p.count} tracks)`;
    sel.appendChild(opt);
    if (renameSel) {
      const ropt = opt.cloneNode(true) as HTMLOptionElement;
      renameSel.appendChild(ropt);
    }
  });
  if (nameToSelect && sel.querySelector(`option[value="${CSS.escape(nameToSelect)}"]`)) {
    sel.value = nameToSelect;
    sel.dispatchEvent(new Event("change"));
  }
}

loadPlaylistSelect();

connectQueueSSE();

const playlistEventSrc = new EventSource("/api/events/playlists");
playlistEventSrc.onmessage = () => {
  loadPlaylistSelect();
};

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    const tab = t as HTMLElement;
    document
      .querySelectorAll(".tab")
      .forEach((x) => x.classList.remove("active"));
    tab.classList.add("active");
    document
      .querySelectorAll(".mode-section")
      .forEach((s) => s.classList.remove("active"));
    const me = $("mode-" + tab.dataset.mode);
    if (me) me.classList.add("active");
    SETTINGS_PANEL.style.display = "none";
    if (tab.dataset.mode !== "queue") clearAll();
    if (tab.dataset.mode !== "playlist") clearPlaylistState();
  });
});

$btn("btn-settings-toggle").addEventListener("click", () => {
  const isOpen = SETTINGS_PANEL.style.display === "flex";
  SETTINGS_PANEL.style.display = isOpen ? "none" : "flex";
  if (!isOpen) {
    loadCookiesStatus();
    loadCookieInspect();
    loadDownloads();
    loadYtdlpVersion();
  }
clearAll();
});

SETTINGS_PANEL.addEventListener("click", (e) => {
  if (e.target === SETTINGS_PANEL) SETTINGS_PANEL.style.display = "none";
});

$btn("btn-settings-close").addEventListener("click", () => {
  SETTINGS_PANEL.style.display = "none";
});

document.querySelectorAll(".settings-tab").forEach((t) => {
  t.addEventListener("click", () => {
    const tab = t as HTMLElement;
    document
      .querySelectorAll(".settings-tab")
      .forEach((x) => x.classList.remove("active"));
    tab.classList.add("active");
    document
      .querySelectorAll(".settings-stab")
      .forEach((s) => s.classList.remove("active"));
    const stab = $(("." as any) + tab.dataset.stab) as HTMLElement;
    const st = document.querySelector(
      `.settings-stab[data-stab="${tab.dataset.stab}"]`,
    ) as HTMLElement;
    if (st) st.classList.add("active");
  });
});

$btn("btn-manual-search").addEventListener("click", () => {
  const q = MANUAL_INPUT.value.trim();
  if (q) search(q, "manual");
});
MANUAL_INPUT.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") $btn("btn-manual-search").click();
});

MANUAL_INPUT.addEventListener("focus", () => {
  if (getRecent().length) renderRecent();
});
MANUAL_INPUT.addEventListener("blur", () =>
  setTimeout(() => recentEl.classList.remove("visible"), 200),
);
MANUAL_INPUT.addEventListener("input", () =>
  recentEl.classList.remove("visible"),
);

$btn("btn-paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      MANUAL_INPUT.value = text;
      MANUAL_INPUT.focus();
    }
  } catch {
    showError(
      "Cannot read clipboard. Allow clipboard access or paste manually.",
    );
  }
});

$sel("playlist-select").addEventListener("change", async (e: Event) => {
  const name = (e.target as HTMLSelectElement).value;
  currentPlaylistName = name;
  if (!name) {
    $("playlist-info").style.display = "none";
    return;
  }
  const res = await fetch("/api/playlists");
  const playlists: PlaylistInfo[] = await res.json();
  const pl = playlists.find((p) => p.name === name);
  if (!pl) return;
playlistTracks = pl.tracks;
  playlistIndex = 0;
  const tpl = localStorage.getItem("filenameTemplate") || "{artist} - {title}{misc}";
  const checkRes = await fetch("/api/playlists/check-existing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks: pl.tracks, template: tpl }),
  });
  const checkData = await checkRes.json();
  const existingIndices = new Set(checkData.existing as number[]);
  if (existingIndices.size > 0) {
    while (playlistIndex < playlistTracks.length && existingIndices.has(playlistIndex)) {
      playlistIndex++;
    }
  }
  $("playlist-info").style.display = "block";
  const dlBtn = $btn("btn-playlist-dlall");
  if (dlBtn) dlBtn.style.display = pl.tracks.length > 0 ? "" : "none";
  const skipBtn = $btn("btn-playlist-skip");
  if (skipBtn) skipBtn.style.display = "";
  showPlaylistTrack();
});

$btn("btn-playlist-search").addEventListener("click", () => {
  const q = PLAYLIST_INPUT.value.trim();
  if (q) search(q, "playlist");
});
PLAYLIST_INPUT.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") $btn("btn-playlist-search").click();
});

$btn("btn-playlist-dlall").addEventListener("click", downloadAllPlaylist);

$btn("btn-playlist-skip").addEventListener("click", () => {
  if (playlistTracks.length > 0) {
    playlistIndex++;
    showPlaylistTrack();
  }
});

document.getElementById("preview-play-overlay")?.addEventListener("click", () => {
  if (selectedVideo) playPreviewVideo(selectedVideo.id);
});

$btn("btn-preview-close").addEventListener("click", () => {
  PREVIEW.style.display = "none";
  const iframe = document.getElementById(
    "preview-iframe",
  ) as HTMLIFrameElement | null;
  if (iframe) iframe.src = "";
  selectedVideo = null;
  cachedMetadataFields = null;
  dnldItemId = null;
  resetDownloadBtn();
});

$("btn-modal-close").addEventListener("click", () => {
  MODAL.style.display = "none";
  if (modalResolve) modalResolve(false);
});
$btn("btn-modal-cancel").addEventListener("click", () => {
  MODAL.style.display = "none";
  if (modalResolve) modalResolve(false);
});
$btn("btn-modal-confirm").addEventListener("click", () => {
  MODAL.style.display = "none";
  if (modalResolve) modalResolve(true);
});

$btn("btn-cookies-save").addEventListener("click", saveCookies);
$btn("btn-cookies-delete").addEventListener("click", deleteCookies);
$btn("btn-cookies-detect").addEventListener("click", detectCookies);
$btn("btn-cookies-signin").addEventListener("click", signInToYoutube);
$btn("btn-rename-files").addEventListener("click", renamePlaylistFiles);

const tplInput = $input("filename-template");
const savedTpl = localStorage.getItem("filenameTemplate");
if (savedTpl) tplInput.value = savedTpl;
tplInput.addEventListener("input", () => {
  localStorage.setItem(
    "filenameTemplate",
    tplInput.value.trim() || "{artist} - {title}{misc}",
  );
  if (selectedVideo && cachedMetadataFields) reapplyTemplate();
});

document.querySelectorAll(".help-text code").forEach((el) => {
  el.addEventListener("click", () => {
    const tag = el.textContent || "";
    const cursorPos = tplInput.selectionStart || tplInput.value.length;
    tplInput.value = tplInput.value.slice(0, cursorPos) + tag + tplInput.value.slice(cursorPos);
    tplInput.dispatchEvent(new Event("input"));
    tplInput.focus();
  });
});

$sel("default-quality").addEventListener("change", (e: Event) => {
  const v = (e.target as HTMLSelectElement).value;
  localStorage.setItem("defaultQuality", v);
  selectedQuality = v;
});

$input("max-concurrent").addEventListener("change", async (e: Event) => {
  const v = (e.target as HTMLInputElement).value;
  localStorage.setItem("maxConcurrent", v);
  await fetch("/api/queue/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_concurrent: parseInt(v, 10) || 2 }),
  });
});

$input("output-dir").addEventListener("input", (e: Event) => {
  localStorage.setItem("outputDir", (e.target as HTMLInputElement).value);
});

$btn("btn-import-playlist").addEventListener("click", async () => {
  const url = $input("import-playlist-url").value.trim();
  const name = $input("import-playlist-name").value.trim();
  const resultEl = $("import-result");
  if (!url || !name) {
    resultEl.innerHTML =
      '<span class="cookies-missing">Enter URL and name</span>';
    return;
  }
  resultEl.innerHTML = '<span class="cookies-missing">Importing...</span>';
  try {
    const res = await fetch("/api/playlists/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name }),
    });
    const data = await res.json();
    if (res.ok) {
      resultEl.innerHTML = `<span class="cookies-ok">&#10003; Imported ${data.count} tracks</span>`;
    } else {
      resultEl.innerHTML = `<span class="cookies-missing">Error: ${data.detail || "Failed"}</span>`;
    }
  } catch (err: unknown) {
    resultEl.innerHTML =
      '<span class="cookies-missing">Error: ' +
      (err instanceof Error ? err.message : String(err)) +
      "</span>";
  }
});

$btn("btn-import-from-url").addEventListener("click", async () => {
  const resultEl = $("import-result");
  const urlInput = $input("import-playlist-url");
  try {
    const text = await navigator.clipboard.readText();
    const trimmed = text.trim();
    if (
      !trimmed ||
      !/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/playlist\?/.test(trimmed)
    ) {
      resultEl.innerHTML =
        '<span class="cookies-missing">Clipboard does not contain a YouTube playlist URL</span>';
      return;
    }
    urlInput.value = trimmed;
    resultEl.innerHTML = '<span class="cookies-missing">Fetching playlist name from YouTube...</span>';
    const res = await fetch("/api/playlists/import-from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed, name: "" }),
    });
    const data = await res.json();
    if (res.ok) {
      resultEl.innerHTML = `<span class="cookies-ok">&#10003; Imported "${data.name}" (${data.count} tracks)</span>`;
    } else {
      resultEl.innerHTML = `<span class="cookies-missing">Error: ${data.detail || "Failed"}</span>`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("read")) {
      resultEl.innerHTML = '<span class="cookies-missing">Cannot read clipboard. Paste the URL manually and click Import.</span>';
    } else {
      resultEl.innerHTML = '<span class="cookies-missing">Error: ' + msg + "</span>";
    }
  }
});

$btn("btn-playlist-import").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    const trimmed = text.trim();
    if (
      !trimmed ||
      !/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/playlist\?/.test(trimmed)
    ) {
      showError("Clipboard does not contain a YouTube playlist URL");
      return;
    }
    const res = await fetch("/api/playlists/import-from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed, name: "" }),
    });
    const data = await res.json();
    if (res.ok) {
      showError(`Imported "${data.name}" (${data.count} tracks)`);
      await loadPlaylistSelect(data.name);
    } else {
      showError("Import failed: " + (data.detail || "Unknown error"));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("read")) {
      showError("Cannot read clipboard. Paste the URL in Settings > Playlist Import instead.");
    } else {
      showError("Import error: " + msg);
    }
  }
});

async function renderYtdlpVersion(data: YtdlpVersionInfo): Promise<void> {
  const el = $("ytdlp-version");
  if (el) {
    el.textContent = data.version || "Unavailable";
  }
  const latestRow = $("ytdlp-latest");
  if (latestRow) {
    if (data.latest) {
      const same = !data.update_available;
      latestRow.innerHTML = same
        ? `<span class="cookies-ok">&#10003; Up to date (latest: ${data.latest})</span>`
        : `<span class="cookies-missing">Latest on PyPI: ${data.latest}${data.version ? " — update available" : ""}</span>`;
    } else {
      latestRow.innerHTML = "";
    }
  }
  const frozenNote = $("ytdlp-frozen-note");
  if (frozenNote) frozenNote.style.display = data.frozen ? "block" : "none";
  const updateBtn = $btn("btn-ytdlp-update");
  if (data.frozen) {
    updateBtn.style.display = "none";
  } else if (data.version) {
    updateBtn.style.display = "";
  }
}

async function loadYtdlpVersion(): Promise<void> {
  try {
    const res = await fetch("/api/ytdlp/version");
    const data: YtdlpVersionInfo = await res.json();
    await renderYtdlpVersion(data);
  } catch {
    const el = $("ytdlp-version");
    if (el) el.textContent = "Unavailable";
  }
}

$btn("btn-ytdlp-check").addEventListener("click", async () => {
  const resultEl = $("ytdlp-result");
  resultEl.innerHTML = '<span class="cookies-missing">Checking...</span>';
  try {
    const res = await fetch("/api/ytdlp/version");
    const data: YtdlpVersionInfo = await res.json();
    await renderYtdlpVersion(data);
    if (!data.version) {
      resultEl.innerHTML =
        '<span class="cookies-missing">yt-dlp not available</span>';
    } else if (data.update_available) {
      resultEl.innerHTML = `<span class="cookies-missing">Update available: ${data.version} → ${data.latest}</span>`;
    } else if (data.latest) {
      resultEl.innerHTML = `<span class="cookies-ok">&#10003; Up to date (${data.version})</span>`;
    } else {
      resultEl.innerHTML = `<span class="cookies-ok">&#10003; Installed: ${data.version}</span>`;
    }
  } catch {
    resultEl.innerHTML = '<span class="cookies-missing">Failed to check</span>';
  }
});

$btn("btn-ytdlp-update").addEventListener("click", async () => {
  const resultEl = $("ytdlp-result");
  resultEl.innerHTML = '<span class="cookies-missing">Updating...</span>';
  try {
    const res = await fetch("/api/ytdlp/update", { method: "POST" });
    const data = await res.json();
    if (data.updated) {
      resultEl.innerHTML = `<span class="cookies-ok">&#10003; Updated to ${data.version || "latest"}</span>`;
      loadYtdlpVersion();
    } else {
      resultEl.innerHTML =
        '<span class="cookies-missing">Update failed: ' +
        (data.error || "unknown") +
        "</span>";
    }
  } catch (err: unknown) {
    resultEl.innerHTML =
      '<span class="cookies-missing">Error: ' +
      (err instanceof Error ? err.message : String(err)) +
      "</span>";
  }
});

document.querySelectorAll(".quality-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document
      .querySelectorAll(".quality-chip")
      .forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    selectedQuality = (chip as HTMLElement).dataset.quality || "720";
    reapplyTemplate();
  });
});

document.querySelectorAll(".format-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".format-toggle-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedFormat = (btn as HTMLElement).dataset.format || "audio";
    updateQualityVisibility();
    reapplyTemplate();
  });
});

DL_BTN.addEventListener("click", () => download());

$btn("btn-queue-clear").addEventListener("click", async () => {
  await fetch("/api/queue/clear", { method: "POST" });
});

async function loadCookieInspect(): Promise<void> {
  const el = $("cookie-inspect-result");
  if (!el) return;
  try {
    const res = await fetch("/api/cookies/inspect");
    const data = await res.json();
    if (!data.exists) {
      el.innerHTML =
        '<span class="cookies-missing">No cookies file saved</span>';
      return;
    }
    let html = `<span class="cookies-ok">&#10003; ${data.total_cookies} cookies from ${(data.domains || []).join(", ")}</span>`;
    if (data.auth_cookies_present?.length)
      html += `<br><span class="cookies-ok">Auth cookies: ${data.auth_cookies_present.join(", ")}</span>`;
    if (!data.has_all_auth)
      html += `<br><span class="cookies-missing">Missing some auth cookies</span>`;
    el.innerHTML = html;
  } catch {
    el.innerHTML = "";
  }
}

async function loadCookiesStatus(): Promise<void> {
  try {
    const res = await fetch("/api/cookies");
    const data = await res.json();
    const s = $("cookies-status");
    if (!s) return;
    s.innerHTML = data.exists
      ? '<span class="cookies-ok">&#10003; Cookies file saved</span>'
      : '<span class="cookies-missing">No cookies file</span>';
  } catch {
    const s = $("cookies-status");
    if (s) s.textContent = "";
  }
}

async function saveCookies(): Promise<void> {
  const ta = document.getElementById(
    "cookies-textarea",
  ) as HTMLTextAreaElement | null;
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) {
    showError("Paste cookies content first");
    return;
  }
  try {
    const res = await fetch("/api/cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      const s = $("cookies-status");
      if (s)
        s.innerHTML =
          '<span class="cookies-ok">&#10003; Cookies saved successfully</span>';
      ta.value = "";
      loadCookieInspect();
    } else {
      showError("Failed to save cookies");
    }
  } catch {
    showError("Error saving cookies");
  }
}

async function deleteCookies(): Promise<void> {
  try {
    await fetch("/api/cookies", { method: "DELETE" });
    const s = $("cookies-status");
    if (s) s.innerHTML = '<span class="cookies-missing">Cookies deleted</span>';
    loadCookieInspect();
  } catch {
    showError("Error deleting cookies");
  }
}

async function detectCookies(): Promise<void> {
  const el = $("detect-result"),
    hint = $("detect-hint");
  if (!el || !hint) return;
  el.innerHTML = '<span class="cookies-missing">Scanning browsers...</span>';
  hint.style.display = "none";
  try {
    const res = await fetch("/api/cookies/detect", { method: "POST" });
    const data = await res.json();
    if (data.found) {
      let html = `<span class="cookies-ok">&#10003; ${data.total} cookies from ${data.source} (${data.youtube_cookies} for YouTube, ${data.auth_cookies ?? 0} auth)</span>`;
      if (data.has_all_auth === false && data.missing_auth?.length)
        html += `<br><span class="cookies-missing">Missing auth cookies: ${data.missing_auth.join(", ")}</span>`;
      el.innerHTML = html;
      loadCookiesStatus();
      loadCookieInspect();
    } else {
      const per: Record<string, string> = data.per_browser || {};
      const details =
        Object.entries(per)
          .map(([b, s]) => `${b}=${s}`)
          .join(", ") || data.detail;
      const statuses = Object.values(per);
      const hasLocked = statuses.some((v) => v === "locked");
      const hasNotFound =
        statuses.length > 0 &&
        statuses.every(
          (v) => v === "not_found" || v === "no_youtube" || v === "no_cookies",
        );
      el.innerHTML = `<span class="cookies-missing">No cookies — ${details}</span>`;
      if (hasLocked)
        hint.textContent =
          "If auto-detect reports 'locked': close your browser completely (check Task Manager for lingering processes) and try again.";
      else if (hasNotFound)
        hint.textContent =
          "No supported browsers found. Install Chrome, Edge, Firefox, or any Chromium-based browser and sign in to YouTube, then try again.";
      else hint.textContent = "";
      hint.style.display = hint.textContent ? "block" : "none";
    }
  } catch (err: unknown) {
    el.innerHTML =
      '<span class="cookies-missing">Detection failed: ' +
      (err instanceof Error ? err.message : String(err)) +
      "</span>";
  }
}

async function signInToYoutube(): Promise<void> {
  const el = $("signin-status");
  if (!el) return;
  try {
    const statusRes = await fetch("/api/cookies/signin/status");
    const currentStatus = await statusRes.json();
    const isDesktop = currentStatus.mode === "desktop";
    el.innerHTML = isDesktop
      ? '<span class="cookies-missing">Opening sign-in window...</span>'
      : '<span class="cookies-missing">Opening your browser...</span>';
    const res = await fetch("/api/cookies/signin", { method: "POST" });
    const data = await res.json();
    if (data.status === "already_in_progress") {
      el.innerHTML =
        '<span class="cookies-missing">Sign-in already in progress</span>';
      return;
    }
    await pollSigninStatus(el);
  } catch (err: unknown) {
    el.innerHTML =
      '<span class="cookies-missing">Error: ' +
      (err instanceof Error ? err.message : String(err)) +
      "</span>";
  }
}

async function pollSigninStatus(el: HTMLElement): Promise<void> {
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch("/api/cookies/signin/status");
      const data = await res.json();
      if (data.done) {
        const r = data.result;
        if (r?.success) {
          let html = `<span class="cookies-ok">&#10003; ${r.youtube_cookies} YouTube cookies saved`;
          if (r.auth_cookies?.length)
            html += ` (auth: ${r.auth_cookies.join(", ")})`;
          if (!r.has_all_auth)
            html += ' — <span class="cookies-missing">missing some auth cookies</span>';
          html += "</span>";
          el.innerHTML = html;
        } else {
          el.innerHTML = `<span class="cookies-missing">Failed: ${r?.error || "Unknown error"}</span>`;
        }
        loadCookiesStatus();
        loadCookieInspect();
        return;
      }
      if (data.in_progress) {
        el.innerHTML = data.mode === "desktop"
          ? '<span class="cookies-missing">Waiting for sign-in in the new window...</span>'
          : '<span class="cookies-missing">A browser tab opened. Sign in to YouTube, then <strong>close your browser completely</strong> and wait...</span>';
      }
    } catch {
      el.innerHTML = '<span class="cookies-missing">Connection lost</span>';
      return;
    }
  }
  el.innerHTML =
    '<span class="cookies-missing">Sign-in timed out (5 min)</span>';
}

async function renamePlaylistFiles(): Promise<void> {
  const sel = $sel("rename-playlist-select"),
    resultEl = $("rename-result");
  if (!sel || !resultEl) return;
  const name = sel.value;
  if (!name) {
    resultEl.innerHTML =
      '<span class="cookies-missing">Select a playlist</span>';
    return;
  }
  resultEl.innerHTML = '<span class="cookies-missing">Renaming...</span>';
  try {
    const res = await fetch(
      "/api/rename/playlist/" + encodeURIComponent(name),
      { method: "POST" },
    );
    const data = await res.json();
    const renamed = data.renamed || [],
      errors = data.errors || [];
    let html = "";
    if (renamed.length) {
      html += `<span class="cookies-ok">&#10003; Renamed ${renamed.length} files</span>`;
      html +=
        '<br><ul style="margin-top:4px;font-size:0.82rem;color:var(--text-secondary)">';
      renamed.forEach(
        (r: { old: string; new: string }) =>
          (html += `<li>${escapeHtml(r.old)} &#8594; ${escapeHtml(r.new)}</li>`),
      );
      html += "</ul>";
    }
    if (errors.length) {
      html += `<br><span class="cookies-missing">${errors.length} errors</span>`;
      html += '<ul style="margin-top:4px;font-size:0.82rem;color:#ef9a9a">';
      errors.forEach((e: string) => (html += `<li>${escapeHtml(e)}</li>`));
      html += "</ul>";
    }
    if (!renamed.length && !errors.length)
      html = '<span class="cookies-missing">No files found to rename</span>';
    resultEl.innerHTML = html;
    if (renamed.length) loadDownloads();
  } catch (err: unknown) {
    resultEl.innerHTML =
      '<span class="cookies-missing">Error: ' +
      (err instanceof Error ? err.message : String(err)) +
      "</span>";
  }
}

async function loadDownloads(): Promise<void> {
  try {
    const res = await fetch("/api/downloads");
    const data = await res.json();
    const list = $("downloads-list");
    if (!list) return;
    if (!data.files?.length) {
      list.innerHTML = '<p class="help-text">No downloaded files yet.</p>';
      return;
    }
    list.innerHTML =
      "<ul>" +
      data.files
        .map(
          (f: { name: string; size: number }) =>
            `<li><a href="/api/download/${encodeURIComponent(f.name).replace(/%2F/g, "/")}" download="${f.name}">${f.name}</a> <span class="file-size">(${(f.size / 1024 / 1024).toFixed(1)} MB)</span></li>`,
        )
        .join("") +
      "</ul>";
  } catch {
    const list = $("downloads-list");
    if (list) list.textContent = "";
  }
}

