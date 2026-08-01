import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Download, Loader2, List } from "lucide-react";
import type { PlaylistInfo, SearchResult } from "@/types";
import VideoPage from "./video";
import Modal from "@/components/modal";
import EditPlaylist from "../edit";
import DownloadAllModal, {
  type DownloadAllOptions,
} from "./download-all";
import { parseYoutubeTitle, renderFilenameTemplate } from "@/lib/filename";

interface DlProgress {
  active: boolean;
  done: number;
  total: number;
  current: string;
  queued: number;
  skipped: number;
  noResult: number;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function titleSimilarity(query: string, candidate: string): number {
  const a = tokenize(query);
  const b = tokenize(candidate);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(a.size, b.size);
}

function pickBestMatch(
  query: string,
  results: SearchResult[],
): SearchResult | null {
  if (!results.length) return null;
  let best = results[0]!;
  let bestScore = -1;
  for (const r of results) {
    const score = titleSimilarity(query, r.title);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function buildDownloadFilename(
  options: DownloadAllOptions,
  trackTitle: string,
  playlistName: string,
): string {
  const parsed = parseYoutubeTitle(trackTitle);
  return renderFilenameTemplate(options.template, {
    artist: parsed.artist,
    title: parsed.title,
    misc: parsed.misc ? ` [${parsed.misc}]` : "",
    channel: "",
    id: "",
    ext: options.format === "audio" ? "mp3" : "mp4",
    playlist: playlistName,
    quality: options.quality,
    source_title: trackTitle,
  });
}

function PlaylistPage({ selectedPlaylist }: { selectedPlaylist: string }) {
  const [selected, setSelected] = useState<PlaylistInfo | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [openEdit, setOpenEdit] = useState<boolean>(false);
  const [showDownloadAll, setShowDownloadAll] = useState(false);
  const [dlProgress, setDlProgress] = useState<DlProgress>({
    active: false,
    done: 0,
    total: 0,
    current: "",
    queued: 0,
    skipped: 0,
    noResult: 0,
  });
  const [dlSummary, setDlSummary] = useState("");
  const cancelRef = useRef(false);
  const queryClient = useQueryClient();

  const { data } = useQuery<PlaylistInfo[]>({
    queryKey: ["playlists"],
    queryFn: () => fetch("/api/playlists").then((r) => r.json()),
    staleTime: 10_000,
  });

  const playlists = Array.isArray(data) ? data : [];

  useEffect(() => {
    if (selectedPlaylist && playlists.length) {
      const pl = playlists.find((p) => p.name === selectedPlaylist) || null;
      setSelected(pl);
      setCurrentIndex(0);
      cancelRef.current = false;
      setDlProgress({
        active: false,
        done: 0,
        total: 0,
        current: "",
        queued: 0,
        skipped: 0,
        noResult: 0,
      });
      setDlSummary("");
    }
  }, [selectedPlaylist, playlists]);

  const importMutation = useMutation({
    mutationFn: (body: { url: string; name: string }) =>
      fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setImportUrl("");
      setImportName("");
      setShowImport(false);
    },
  });

  const importFromUrlMutation = useMutation({
    mutationFn: (url: string) =>
      fetch("/api/playlists/import-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name: "" }),
      }).then((r) => r.json()),
    onSuccess: (result: { name?: string }) => {
      if (result.name) {
        queryClient.invalidateQueries({ queryKey: ["playlists"] });
      }
    },
  });

  const currentTrack = selected?.tracks[currentIndex] ?? null;
  const isLast = selected ? currentIndex >= selected.tracks.length - 1 : true;

  const advance = useCallback(() => {
    if (!selected) return;
    if (currentIndex < selected.tracks.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  }, [selected, currentIndex]);

  const skip = useCallback(() => {
    if (!selected) return;
    if (currentIndex < selected.tracks.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  }, [selected, currentIndex]);

  async function startDownloadAll(options: DownloadAllOptions) {
    if (!selected) return;
    cancelRef.current = false;
    const total = selected.tracks.length - currentIndex;
    setDlProgress({
      active: true,
      done: 0,
      total,
      current: "",
      queued: 0,
      skipped: 0,
      noResult: 0,
    });
    setDlSummary("");

    let skipSet = new Set<number>();
    if (options.skipExisting) {
      try {
        const res = await fetch("/api/playlists/check-existing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tracks: selected.tracks,
            template: options.template,
          }),
        });
        const d = await res.json();
        skipSet = new Set<number>(d.existing ?? []);
      } catch {
        /* ignore */
      }
    }

    let queued = 0;
    let skipped = 0;
    let noResult = 0;
    for (let i = currentIndex; i < selected.tracks.length; i++) {
      if (cancelRef.current) break;
      const track = selected.tracks[i]!;
      setDlProgress((p) => ({
        ...p,
        done: i - currentIndex + 1,
        current: track,
      }));
      if (skipSet.has(i)) {
        skipped++;
        continue;
      }
      try {
        const res = await fetch(
          `/api/search?query=${encodeURIComponent(track)}&max_results=5`,
        );
        const data = await res.json();
        const best = pickBestMatch(track, data.results ?? []);
        if (!best) {
          noResult++;
          continue;
        }
        const r = await fetch("/api/queue/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: best.url,
            filename: buildDownloadFilename(options, track, selected.name),
            fmt: options.format === "audio" ? "mp3" : "mp4",
            quality: options.quality,
            playlist: selected.name,
            output_dir: localStorage.getItem("outputDir") || "",
            include_thumbnail: false,
          }),
        });
        if (r.ok) queued++;
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    setDlProgress((p) => ({ ...p, active: false }));
    setDlSummary(
      cancelRef.current
        ? `Download All cancelled: queued ${queued}, skipped ${skipped}, no result ${noResult}`
        : `Download All finished: queued ${queued}, skipped ${skipped}, no result ${noResult}`,
    );
  }

  const openDownloadAll = useCallback(() => setShowDownloadAll(true), []);
  const cancelDownloadAll = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row gap-2 p-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowImport(!showImport)}
        >
          <List className="size-4" /> Import
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              importFromUrlMutation.mutate(text.trim());
            } catch {
              /* ignore */
            }
          }}
          loading={importFromUrlMutation.isPending}
        >
          Import from URL
        </Button>
        {selectedPlaylist && (
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedPlaylist}
            onClick={() => setOpenEdit(true)}
          >
            Edit
          </Button>
        )}
      </div>

      {showImport && (
        <div className="flex flex-col gap-2 p-2 mx-2 border border-border">
          <div className="flex flex-row gap-2">
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Playlist URL"
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const text = await navigator.clipboard
                  .readText()
                  .catch(() => "");
                if (text) setImportUrl(text);
              }}
            >
              Paste
            </Button>
          </div>
          <Input
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            placeholder="Playlist name"
          />
          <Button
            variant="accent"
            size="sm"
            onClick={() =>
              importMutation.mutate({
                url: importUrl.trim(),
                name: importName.trim(),
              })
            }
            disabled={!importUrl.trim() || !importName.trim()}
            loading={importMutation.isPending}
          >
            Import
          </Button>
        </div>
      )}

      {selectedPlaylist && openEdit && (
        <Modal header={selectedPlaylist} onClose={() => setOpenEdit(false)}>
          <EditPlaylist
            selectedPlaylist={selectedPlaylist}
            currentTrack={currentIndex}
            setCurrentTrack={setCurrentIndex}
            onClose={() => setOpenEdit(false)}
          />
        </Modal>
      )}

      {selected && showDownloadAll && (
        <Modal
          header={`Download All: ${selected.name}`}
          onClose={() => setShowDownloadAll(false)}
        >
          <DownloadAllModal
            playlistName={selected.name}
            tracks={selected.tracks}
            startIndex={currentIndex}
            onConfirm={(options) => {
              setShowDownloadAll(false);
              startDownloadAll(options);
            }}
            onCancel={() => setShowDownloadAll(false)}
          />
        </Modal>
      )}

      {dlProgress.active && (
        <div className="flex flex-col gap-2 p-2 mx-2 border border-border">
          <div className="flex flex-row items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm font-medium">
              Downloading {dlProgress.done}/{dlProgress.total}
            </span>
            <Button variant="error" size="sm" onClick={cancelDownloadAll}>
              Cancel
            </Button>
          </div>
          <div className="w-full h-2 bg-accent">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${dlProgress.total ? (dlProgress.done / dlProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-xs text-muted truncate">
            {dlProgress.current}
          </span>
          <span className="text-xs text-muted">
            queued {dlProgress.queued} · skipped {dlProgress.skipped} · no
            result {dlProgress.noResult}
          </span>
        </div>
      )}
      {dlSummary && !dlProgress.active && (
        <p className="text-xs text-muted mx-2">{dlSummary}</p>
      )}

      {selected && currentTrack ? (
        <VideoPage
          query=""
          searchKey={0}
          playlistTrack={currentTrack}
          playlistIndex={currentIndex}
          playlistTotal={selected.tracks.length}
          playlistName={selected.name}
          onPlaylistAdvance={advance}
          onPlaylistSkip={!isLast ? skip : undefined}
          onPlaylistDownloadAll={
            dlProgress.active ? undefined : openDownloadAll
          }
        />
      ) : selected ? (
        <p className="text-center text-muted p-4">All tracks done!</p>
      ) : (
        <p className="text-center text-muted p-4">
          Select a playlist from the dropdown above
        </p>
      )}
    </div>
  );
}

export default PlaylistPage;
