import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Download, Loader2, List } from "lucide-react";
import type { PlaylistInfo } from "@/types";
import VideoPage from "./video";

function PlaylistPage({ selectedPlaylist }: { selectedPlaylist: string }) {
  const [selected, setSelected] = useState<PlaylistInfo | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [downloadedTracks, setDownloadedTracks] = useState<Set<number>>(
    new Set(),
  );
  const [dlAll, setDlAll] = useState(false);
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
      setDownloadedTracks(new Set());
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

  async function downloadAll() {
    if (!selected) return;
    setDlAll(true);
    for (let i = currentIndex; i < selected.tracks.length; i++) {
      if (downloadedTracks.has(i)) continue;
      try {
        const res = await fetch(
          `/api/search?query=${encodeURIComponent(selected.tracks[i]!)}&max_results=1`,
        );
        const data = await res.json();
        const first = data.results?.[0];
        if (!first) continue;
        const r = await fetch("/api/queue/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: first.url,
            filename: selected.tracks[i]!
              .replace(/[\\/:*?"<>|]/g, "_")
              .slice(0, 120),
            fmt: "mp3",
            quality: "720",
            playlist: selected.name,
            output_dir: "",
            include_thumbnail: false,
          }),
        });
        if (r.ok)
          setDownloadedTracks((prev) => new Set(prev).add(i));
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    setDlAll(false);
  }

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
          disabled={importFromUrlMutation.isPending}
        >
          Import from URL
        </Button>
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
                const text = await navigator.clipboard.readText().catch(() => "");
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
            disabled={
              importMutation.isPending ||
              !importUrl.trim() ||
              !importName.trim()
            }
          >
            {importMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}{" "}
            Import
          </Button>
        </div>
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
          onPlaylistDownloadAll={dlAll ? undefined : downloadAll}
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
