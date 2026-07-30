import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Download, Loader2, List, SkipForward } from "lucide-react";
import type { PlaylistInfo } from "@/types";
import VideoPage from "./video";

function PlaylistPage({ selectedPlaylist }: { selectedPlaylist: string }) {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [selected, setSelected] = useState<PlaylistInfo | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<number>>(new Set());
  const [dlAll, setDlAll] = useState(false);

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/playlists");
      const d = await res.json();
      if (Array.isArray(d)) setPlaylists(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPlaylists(); }, [loadPlaylists]);

  useEffect(() => {
    if (selectedPlaylist && playlists.length) {
      const pl = playlists.find(p => p.name === selectedPlaylist) || null;
      setSelected(pl);
      setCurrentIndex(0);
      setDownloadedTracks(new Set());
    }
  }, [selectedPlaylist, playlists]);

  async function doImport() {
    if (!importUrl.trim() || !importName.trim()) return;
    setImporting(true);
    try {
      await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim(), name: importName.trim() }),
      });
      await loadPlaylists();
      setImportUrl("");
      setImportName("");
      setShowImport(false);
    } catch { /* ignore */ }
    setImporting(false);
  }

  const currentTrack = selected?.tracks[currentIndex] ?? null;
  const isLast = selected ? currentIndex >= selected.tracks.length - 1 : true;

  const advance = useCallback(() => {
    if (!selected) return;
    if (currentIndex < selected.tracks.length - 1) {
      setCurrentIndex(i => i + 1);
    }
  }, [selected, currentIndex]);

  const skip = useCallback(() => {
    if (!selected) return;
    if (currentIndex < selected.tracks.length - 1) {
      setCurrentIndex(i => i + 1);
    }
  }, [selected, currentIndex]);

  async function downloadAll() {
    if (!selected) return;
    setDlAll(true);
    for (let i = currentIndex; i < selected.tracks.length; i++) {
      if (downloadedTracks.has(i)) continue;
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(selected.tracks[i]!)}&max_results=1`);
        const data = await res.json();
        const first = data.results?.[0];
        if (!first) continue;
        const r = await fetch("/api/queue/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: first.url,
            filename: selected.tracks[i]!.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120),
            fmt: "mp3",
            quality: "720",
            playlist: selected.name,
            output_dir: "",
            include_thumbnail: false,
          }),
        });
        if (r.ok) setDownloadedTracks(prev => new Set(prev).add(i));
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 500));
    }
    setDlAll(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row gap-2 p-2">
        <Button variant="outline" size="sm" onClick={() => setShowImport(!showImport)}>
          <List className="size-4" /> Import
        </Button>
        <Button variant="outline" size="sm" onClick={async () => {
          try {
            const text = await navigator.clipboard.readText();
            const res = await fetch("/api/playlists/import-from-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: text.trim(), name: "" }),
            });
            const result = await res.json();
            if (result.name) await loadPlaylists();
          } catch { /* ignore */ }
        }}>
          Import from URL
        </Button>
      </div>

      {showImport && (
        <div className="flex flex-col gap-2 p-2 mx-2 border border-border">
          <div className="flex flex-row gap-2">
            <Input value={importUrl} onChange={e => setImportUrl(e.target.value)} placeholder="Playlist URL" className="flex-1" />
            <Button variant="outline" size="sm" onClick={async () => {
              const text = await navigator.clipboard.readText().catch(() => "");
              if (text) setImportUrl(text);
            }}>Paste</Button>
          </div>
          <Input value={importName} onChange={e => setImportName(e.target.value)} placeholder="Playlist name" />
          <Button variant="accent" size="sm" onClick={doImport} disabled={importing || !importUrl.trim() || !importName.trim()}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : null} Import
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
        <p className="text-center text-muted p-4">Select a playlist from the dropdown above</p>
      )}
    </div>
  );
}

export default PlaylistPage;
