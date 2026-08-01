import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type {
  PlaylistCleanupOptions,
  PlaylistCleanupResult,
  PlaylistInfo,
} from "@/types";
import { Check, Loader2 } from "lucide-react";

const CLEANUP_OPTIONS: { key: keyof PlaylistCleanupOptions; label: string }[] =
  [
    { key: "removeHeaders", label: "Remove header lines" },
    { key: "removeIndexes", label: "Remove leading indexes" },
    { key: "removeUrls", label: "Remove URL lines" },
    { key: "removeTimestamps", label: "Remove timestamps" },
    { key: "dedupe", label: "Deduplicate tracks" },
    { key: "normalizeTitles", label: "Normalize titles (Artist - Title)" },
  ];

const DEFAULT_OPTIONS: PlaylistCleanupOptions = {
  removeHeaders: true,
  removeIndexes: true,
  removeUrls: true,
  removeTimestamps: true,
  dedupe: true,
  normalizeTitles: false,
};

function PlaylistEditor({
  selectedPlaylist,
  onClose,
}: {
  selectedPlaylist: string;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applyMode, setApplyMode] = useState<"all" | "selected">("all");
  const [bitrate, setBitrate] = useState("128k");
  const [renameValue, setRenameValue] = useState(selectedPlaylist);
  const [cleanupOptions, setCleanupOptions] =
    useState<PlaylistCleanupOptions>(DEFAULT_OPTIONS);
  const [preview, setPreview] = useState<PlaylistCleanupResult | null>(null);
  const [resyncUrl, setResyncUrl] = useState("");

  const [audioBusy, setAudioBusy] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const [resyncBusy, setResyncBusy] = useState(false);

  const [audioResult, setAudioResult] = useState("");
  const [renameResult, setRenameResult] = useState("");
  const [cleanupResult, setCleanupResult] = useState("");
  const [convertResult, setConvertResult] = useState("");
  const [resyncResult, setResyncResult] = useState("");

  const [existing, setExisting] = useState<Set<number>>(new Set());

  const { data, isLoading, isError, error } = useQuery<PlaylistInfo>({
    queryKey: ["editPlaylist", selectedPlaylist],
    queryFn: async (): Promise<PlaylistInfo> => {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch playlist");
      else return res.json();
    },
    enabled: !!selectedPlaylist,
    staleTime: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const tracks = data?.tracks ?? [];
    if (!tracks.length) {
      setExisting(new Set());
      return;
    }
    const template =
      localStorage.getItem("filenameTemplate") || "{artist} - {title}{misc}";
    fetch("/api/playlists/check-existing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks, template }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setExisting(new Set((d.existing ?? []) as number[]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data]);

  const tracks = data?.tracks ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks.map((t, i) => ({ t, i }));
    return tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.toLowerCase().includes(q));
  }, [tracks, search]);

  const allShownSelected =
    filtered.length > 0 && filtered.every(({ i }) => selected.has(i));

  const toggleIndex = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) {
        for (const { i } of filtered) next.delete(i);
      } else {
        for (const { i } of filtered) next.add(i);
      }
      return next;
    });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["editPlaylist"] });
    queryClient.invalidateQueries({ queryKey: ["playlists"] });
  };

  const selectedIndices = (): number[] | undefined =>
    applyMode === "selected" ? Array.from(selected) : undefined;

  const busy =
    audioBusy || renameBusy || cleanupBusy || convertBusy || resyncBusy;

  async function doRename() {
    const newName = renameValue.trim();
    if (!newName || newName === selectedPlaylist || renameBusy) return;
    setRenameBusy(true);
    setRenameResult("");
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/rename`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: newName }),
        },
      );
      const d = await res.json();
      if (!res.ok) {
        setRenameResult(d.error || "Rename failed");
      } else {
        setRenameResult(`Renamed to "${d.name}"`);
        invalidate();
        onClose?.();
      }
    } catch (e) {
      setRenameResult(String(e));
    }
    setRenameBusy(false);
  }

  async function doPreview() {
    setCleanupBusy(true);
    setPreview(null);
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/cleanup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: cleanupOptions, dry_run: true }),
        },
      );
      const d = await res.json();
      if (!res.ok) setCleanupResult(d.error || "Preview failed");
      else setPreview(d as PlaylistCleanupResult);
    } catch (e) {
      setCleanupResult(String(e));
    }
    setCleanupBusy(false);
  }

  async function doCleanup() {
    setCleanupBusy(true);
    setPreview(null);
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/cleanup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: cleanupOptions }),
        },
      );
      const d = await res.json();
      if (!res.ok) {
        setCleanupResult(d.error || "Cleanup failed");
      } else {
        const r = d as PlaylistCleanupResult;
        setCleanupResult(
          `Cleaned: ${r.before} → ${r.after} tracks (${r.removed} removed)`,
        );
        setPreview(null);
        invalidate();
      }
    } catch (e) {
      setCleanupResult(String(e));
    }
    setCleanupBusy(false);
  }

  async function doConvert() {
    setConvertBusy(true);
    setConvertResult("");
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/convert-csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: cleanupOptions }),
        },
      );
      const d = await res.json();
      if (!res.ok) {
        setConvertResult(d.error || "Conversion failed");
      } else {
        setConvertResult(`Converted to .csv (${d.count} tracks)`);
        invalidate();
      }
    } catch (e) {
      setConvertResult(String(e));
    }
    setConvertBusy(false);
  }

  async function doCompress() {
    if (audioBusy) return;
    setAudioBusy(true);
    setAudioResult("");
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/compress`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            indices: selectedIndices(),
            bitrate,
          }),
        },
      );
      const d = await res.json();
      if (!res.ok) setAudioResult(d.error || "Compression failed");
      else
        setAudioResult(
          `Compressed ${d.processed} file(s)${
            d.errors ? ` (${d.errors} errors)` : ""
          }`,
        );
    } catch (e) {
      setAudioResult(String(e));
    }
    setAudioBusy(false);
  }

  async function doNormalize() {
    if (audioBusy) return;
    setAudioBusy(true);
    setAudioResult("");
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/normalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ indices: selectedIndices() }),
        },
      );
      const d = await res.json();
      if (!res.ok) setAudioResult(d.error || "Normalization failed");
      else
        setAudioResult(
          `Normalized ${d.processed} file(s)${
            d.errors ? ` (${d.errors} errors)` : ""
          }`,
        );
    } catch (e) {
      setAudioResult(String(e));
    }
    setAudioBusy(false);
  }

  async function doResync() {
    const url = resyncUrl.trim();
    if (!url || resyncBusy) return;
    setResyncBusy(true);
    setResyncResult("");
    try {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/resync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );
      const d = await res.json();
      if (!res.ok) {
        setResyncResult(d.error || "Re-sync failed");
      } else {
        setResyncResult(
          `Synced ${d.count} tracks (+${d.addedCount} added, -${d.removedCount} removed)`,
        );
        invalidate();
      }
    } catch (e) {
      setResyncResult(String(e));
    }
    setResyncBusy(false);
  }

  if (isLoading)
    return (
      <main className="flex flex-col w-full h-full items-center justify-center">
        <span className="text-center text-muted p-4">
          Loading playlist data...
        </span>
      </main>
    );

  if (isError)
    return (
      <main className="flex flex-col w-full h-full items-center justify-center">
        <span className="text-center text-muted p-4">
          Error while loading playlist data...
        </span>
        <span className="text-center text-red-500/50 p-4">{error.message}</span>
      </main>
    );

  const needsSelection = applyMode === "selected" && selected.size === 0;

  return (
    <main className="flex flex-col gap-2 p-2 max-h-130 overflow-y-auto">
      {/* search + selection */}
      <section className="flex flex-row items-center gap-2 p-2 border border-border">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tracks..."
          className="flex-1 p-1 text-sm"
          disabled={busy}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={toggleAll}
          disabled={!filtered.length || busy}
        >
          {allShownSelected ? "None" : "All"}
        </Button>
        <span className="text-xs text-muted shrink-0">
          {selected.size} selected
        </span>
      </section>

      {/* audio tools */}
      <section className="flex flex-col gap-2 border border-border p-2">
        <h3 className="font-bold text-sm">Audio Tools</h3>
        <div className="flex flex-row items-center gap-2 flex-wrap">
          <label className="text-xs text-muted">Apply to:</label>
          <select
            value={applyMode}
            onChange={(e) => setApplyMode(e.target.value as "all" | "selected")}
            className="bg-accent text-text p-1 border border-border text-xs"
            disabled={busy}
          >
            <option value="all">All tracks</option>
            <option value="selected">Selected tracks</option>
          </select>
          <select
            value={bitrate}
            onChange={(e) => setBitrate(e.target.value)}
            className="bg-accent text-text p-1 border border-border text-xs"
            disabled={busy}
          >
            <option value="128k">128 kbps</option>
            <option value="160k">160 kbps</option>
            <option value="192k">192 kbps</option>
          </select>
          <Button
            variant="accent"
            size="sm"
            onClick={doCompress}
            disabled={audioBusy || needsSelection}
          >
            {audioBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Compress
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={doNormalize}
            disabled={audioBusy || needsSelection}
          >
            {audioBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Normalize
          </Button>
        </div>
        {audioResult && <p className="text-xs text-muted">{audioResult}</p>}
      </section>

      {/* rename */}
      <section className="flex flex-col gap-2 border border-border p-2">
        <h3 className="font-bold text-sm">Rename Playlist</h3>
        <div className="flex flex-row gap-2">
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="flex-1 p-1 text-sm"
            disabled={renameBusy}
          />
          <Button
            variant="accent"
            size="sm"
            onClick={doRename}
            disabled={
              renameBusy ||
              !renameValue.trim() ||
              renameValue.trim() === selectedPlaylist
            }
          >
            {renameBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Rename
          </Button>
        </div>
        {renameResult && <p className="text-xs text-muted">{renameResult}</p>}
      </section>

      {/* cleanup */}
      <section className="flex flex-col gap-2 border border-border p-2">
        <h3 className="font-bold text-sm">Cleanup</h3>
        <div className="flex flex-row flex-wrap gap-x-4 gap-y-1">
          {CLEANUP_OPTIONS.map(({ key, label }) => (
            <label
              key={key}
              className="flex flex-row items-center gap-1 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={!!cleanupOptions[key]}
                onChange={(e) =>
                  setCleanupOptions((prev) => ({
                    ...prev,
                    [key]: e.target.checked,
                  }))
                }
                className="size-4 cursor-pointer"
                disabled={cleanupBusy}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={doPreview}
            disabled={cleanupBusy}
          >
            {cleanupBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Preview
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={doCleanup}
            disabled={cleanupBusy}
          >
            {cleanupBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Apply
          </Button>
        </div>
        {cleanupResult && <p className="text-xs text-muted">{cleanupResult}</p>}
        {preview && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted">
              Preview: {preview.before} → {preview.after} tracks (
              {preview.removed} removed)
            </p>
            {preview.removedLines.length > 0 && (
              <pre className="text-xs text-muted whitespace-pre-wrap h-24 border border-border p-1">
                {preview.removedLines.map((l, i) => `- ${l}`).join("\n")}
              </pre>
            )}
          </div>
        )}
      </section>

      {/* convert + sync */}
      <section className="flex flex-col gap-2 border border-border p-2">
        <h3 className="font-bold text-sm">Convert / Sync</h3>
        <div className="flex flex-row gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={doConvert}
            disabled={convertBusy}
          >
            {convertBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Convert to CSV
          </Button>
          <Input
            value={resyncUrl}
            onChange={(e) => setResyncUrl(e.target.value)}
            placeholder="YouTube playlist URL (re-sync)"
            className="flex-1 p-1 text-sm"
            disabled={resyncBusy}
          />
          <Button
            variant="accent"
            size="sm"
            onClick={doResync}
            disabled={resyncBusy || !resyncUrl.trim()}
          >
            {resyncBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            Re-sync
          </Button>
        </div>
        {convertResult && <p className="text-xs text-muted">{convertResult}</p>}
        {resyncResult && <p className="text-xs text-muted">{resyncResult}</p>}
      </section>

      {/* tracks */}
      <section className="flex flex-col gap-1 w-full p-1 border border-border">
        {filtered.length === 0 ? (
          <span className="p-4 text-center text-sm text-muted">
            No matching tracks
          </span>
        ) : (
          filtered.map(({ t, i }) => (
            <div
              key={`${t}-${i}`}
              className="flex flex-row items-center gap-2 p-1 border border-border"
            >
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggleIndex(i)}
                className="size-4 cursor-pointer shrink-0"
                disabled={busy}
              />
              <span className="w-fit min-w-8 max-w-10 shrink-0 text-center text-xs text-muted select-none">
                [ {i + 1} ]
              </span>
              <span className="flex-1 min-w-0 truncate text-sm" title={t}>
                {t}
              </span>
              {existing.has(i) && (
                <span className="text-success shrink-0" title="Downloaded">
                  <Check className="size-4" />
                </span>
              )}
            </div>
          ))
        )}
      </section>
    </main>
  );
}

export default PlaylistEditor;
