import { useState, useEffect } from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Download, SkipForward, Loader2, List, Check, X } from "lucide-react";
import type { PlaylistInfo } from "@/types";

function PlaylistPage({ selectedPlaylist }: { selectedPlaylist: string }) {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [selected, setSelected] = useState<PlaylistInfo | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);
  const [dlAll, setDlAll] = useState(false);
  const [downloadedTracks, setDownloadedTracks] = useState<Set<number>>(new Set());
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);

  useEffect(() => { loadPlaylists(); }, []);

  useEffect(() => {
    if (selectedPlaylist && playlists.length) {
      const pl = playlists.find(p => p.name === selectedPlaylist) || null;
      setSelected(pl);
      setCurrentIndex(0);
      setDownloadedTracks(new Set());
    }
  }, [selectedPlaylist, playlists]);

  async function loadPlaylists() {
    try {
      const res = await fetch("/api/playlists");
      const d = await res.json();
      if (Array.isArray(d)) setPlaylists(d);
    } catch { /* ignore */ }
  }

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

  async function downloadTrack(track: string, index: number) {
    setDownloadingIndex(index);
    try {
      const searchRes = await fetch(`/api/search?query=${encodeURIComponent(track)}&max_results=1`);
      const searchData = await searchRes.json();
      const first = searchData.results?.[0];
      if (!first) return;

      const res = await fetch("/api/queue/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: first.url,
          filename: track.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120),
          fmt: "mp3",
          quality: "720",
          playlist: selected?.name || "",
          output_dir: "",
          include_thumbnail: false,
        }),
      });
      if (res.ok) {
        setDownloadedTracks(prev => new Set(prev).add(index));
      }
    } catch { /* ignore */ }
    setDownloadingIndex(null);
  }

  async function downloadAll() {
    if (!selected) return;
    setDlAll(true);
    for (let i = 0; i < selected.tracks.length; i++) {
      if (downloadedTracks.has(i)) continue;
      await downloadTrack(selected.tracks[i]!, i);
      await new Promise(r => setTimeout(r, 500));
    }
    setDlAll(false);
  }

  function skip() {
    if (!selected) return;
    setCurrentIndex(i => Math.min(i + 1, selected!.tracks.length - 1));
  }

  return (
    <div className="flex flex-col p-2 gap-2">
      <div className="flex flex-row gap-2">
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
        <div className="flex flex-col gap-2 p-2 border border-border">
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

      {selected && selected.tracks.length > 0 && (
        <>
          <div className="border border-border p-2">
            <p className="text-sm mb-2">
              Track {currentIndex + 1} of {selected.tracks.length}
            </p>
            <Input value={selected.tracks[currentIndex] || ""} readOnly className="mb-2" />
            <div className="flex flex-row gap-2">
              <Button variant="accent" size="sm" onClick={() => downloadTrack(selected.tracks[currentIndex]!, currentIndex)} disabled={downloadingIndex === currentIndex}>
                {downloadingIndex === currentIndex ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download
              </Button>
              <Button variant="outline" size="sm" onClick={skip}>
                <SkipForward className="size-4" /> Skip
              </Button>
              <Button variant="accent" size="sm" onClick={downloadAll} disabled={dlAll} className="ml-auto">
                {dlAll ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download All
              </Button>
            </div>
          </div>

          <div className="border border-border max-h-80 overflow-y-auto">
            {selected.tracks.map((track, i) => (
              <div key={i}
                className={`flex flex-row items-center gap-2 p-2 text-sm border-b border-border last:border-0 cursor-pointer hover:bg-accent/50 ${i === currentIndex ? "bg-accent font-bold" : ""}`}
                onClick={() => setCurrentIndex(i)}>
                <span className="text-muted w-6 shrink-0 text-right">{i + 1}</span>
                <span className="flex-1 truncate">{track}</span>
                {downloadingIndex === i && <Loader2 className="size-3 animate-spin shrink-0" />}
                {downloadedTracks.has(i) && <Check className="size-3 text-success shrink-0" />}
              </div>
            ))}
          </div>
        </>
      )}

      {!selected && (
        <p className="text-center text-muted p-4">Select a playlist from the dropdown above</p>
      )}
    </div>
  );
}

export default PlaylistPage;
