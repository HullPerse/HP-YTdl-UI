import { useState, useEffect } from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type { PlaylistInfo } from "@/types";

function PlaylistSettings() {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameResult, setRenameResult] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  useEffect(() => { loadPlaylists(); }, []);

  async function loadPlaylists() {
    try {
      const res = await fetch("/api/playlists");
      const d = await res.json();
      if (Array.isArray(d)) setPlaylists(d);
    } catch { /* ignore */ }
  }

  async function renameFiles() {
    if (!selected) return;
    setRenaming(true);
    setRenameResult("");
    try {
      const res = await fetch(`/api/rename/playlist/${encodeURIComponent(selected)}`, { method: "POST" });
      const d = await res.json();
      const lines = [
        ...(d.renamed || []).map((r: { old: string; new: string }) => `${r.old} → ${r.new}`),
        ...(d.errors || []).map((e: string) => `Error: ${e}`),
      ];
      setRenameResult(lines.join("\n") || "Nothing to rename");
    } catch (e) {
      setRenameResult(String(e));
    }
    setRenaming(false);
  }

  async function importPlaylist() {
    if (!importUrl.trim() || !importName.trim()) return;
    setImporting(true);
    setImportResult("");
    try {
      const res = await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim(), name: importName.trim() }),
      });
      const d = await res.json();
      if (d.detail) { setImportResult(`Error: ${d.detail}`); return; }
      setImportResult(`Imported ${d.count} tracks as "${d.name}"`);
      setImportUrl("");
      setImportName("");
      loadPlaylists();
    } catch (e) {
      setImportResult(String(e));
    }
    setImporting(false);
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setImportUrl(text.trim());
    } catch { setImportResult("Cannot read clipboard"); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Import Playlist">
        <div className="flex flex-col gap-2">
          <div className="flex flex-row gap-2">
            <Input value={importUrl} onChange={e => setImportUrl(e.target.value)} placeholder="YouTube playlist URL" className="flex-1" />
            <Button variant="outline" size="sm" onClick={importFromClipboard}>Paste</Button>
          </div>
          <Input value={importName} onChange={e => setImportName(e.target.value)} placeholder="Playlist name" />
          <Button variant="accent" size="sm" onClick={importPlaylist} disabled={importing || !importUrl.trim() || !importName.trim()}>
            {importing ? "Importing..." : "Import"}
          </Button>
          {importResult && <p className="text-xs text-muted">{importResult}</p>}
        </div>
      </Section>

      <Section title="Rename Downloaded Files">
        <div className="flex flex-col gap-2">
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="bg-accent text-text p-2 border border-border"
          >
            <option value="">Select a playlist...</option>
            {playlists.map(p => <option key={p.name} value={p.name}>{p.name} ({p.count} tracks)</option>)}
          </select>
          <Button variant="accent" size="sm" onClick={renameFiles} disabled={renaming || !selected}>
            {renaming ? "Renaming..." : "Rename Files"}
          </Button>
          {renameResult && <pre className="text-xs text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">{renameResult}</pre>}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border p-3 rounded">
      <h3 className="font-bold text-sm mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default PlaylistSettings;
