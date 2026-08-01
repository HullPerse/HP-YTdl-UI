import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Pencil } from "lucide-react";
import Modal from "@/components/modal";
import PlaylistEditor from "./edit";
import type { PlaylistInfo } from "@/types";

function PlaylistSettings() {
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameResult, setRenameResult] = useState("");
  const [renameTemplate, setRenameTemplate] = useState(
    "{artist} - {title}{misc}",
  );
  const [renameDryRun, setRenameDryRun] = useState(true);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const queryClient = useQueryClient();

  const { data } = useQuery<PlaylistInfo[]>({
    queryKey: ["playlists"],
    queryFn: () => fetch("/api/playlists").then((r) => r.json()),
    staleTime: 10_000,
  });

  const playlists = Array.isArray(data) ? data : [];

  const importMutation = useMutation({
    mutationFn: (body: { url: string; name: string }) => {
      const isSpotify = /open\.spotify\.com\//.test(body.url);
      return fetch(
        isSpotify ? "/api/playlists/import-spotify" : "/api/playlists/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isSpotify ? { url: body.url } : body),
        },
      ).then((r) => r.json());
    },
    onSuccess: (d: { detail?: string; count?: number; name?: string }) => {
      if (d.detail) {
        setImportResult(`Error: ${d.detail}`);
        return;
      }
      setImportResult(`Imported ${d.count} tracks as "${d.name}"`);
      setImportUrl("");
      setImportName("");
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
    onError: (e: Error) => {
      setImportResult(String(e));
    },
    onSettled: () => {
      setImporting(false);
    },
  });

  async function renameFiles() {
    if (!selected) return;
    setRenaming(true);
    setRenameResult("");
    try {
      const res = await fetch(
        `/api/rename/playlist/${encodeURIComponent(selected)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: renameTemplate,
            dry_run: renameDryRun,
          }),
        },
      );
      const d = await res.json();
      if (d.detail) {
        setRenameResult(`Error: ${d.detail}`);
        return;
      }
      const lines = [
        ...(d.renamed || []).map(
          (r: { old: string; new: string }) => `${r.old} → ${r.new}`,
        ),
        ...(d.skipped || []).map(
          (s: { file: string; reason: string }) =>
            `(skip) ${s.file} — ${s.reason}`,
        ),
        ...(d.errors || []).map((e: string) => `Error: ${e}`),
      ];
      if (d.dry_run) {
        lines.unshift(`[preview] ${lines.length} file(s) to rename`);
      }
      setRenameResult(lines.join("\n") || "Nothing to rename");
    } catch (e) {
      setRenameResult(String(e));
    }
    setRenaming(false);
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setImportUrl(text.trim());
    } catch {
      setImportResult("Cannot read clipboard");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Import Playlist">
        <div className="flex flex-col gap-2">
          <div className="flex flex-row gap-2">
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="YouTube or Spotify playlist URL"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={importFromClipboard}>
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
            onClick={() => {
              setImporting(true);
              importMutation.mutate({
                url: importUrl.trim(),
                name: importName.trim(),
              });
            }}
            disabled={importing || !importUrl.trim() || !importName.trim()}
          >
            {importing ? "Importing..." : "Import"}
          </Button>
          {importResult && <p className="text-xs text-muted">{importResult}</p>}
        </div>
      </Section>

      <Section title="Rename Downloaded Files">
        <div className="flex flex-col gap-2">
          <div className="flex flex-row gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 bg-accent text-text p-2 border border-border"
            >
              <option value="">Select a playlist...</option>
              {playlists.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.count} tracks)
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={!selected}
              title="Edit selected playlist"
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          </div>
          <Input
            value={renameTemplate}
            onChange={(e) => setRenameTemplate(e.target.value)}
            placeholder="Filename template, e.g. {artist} - {title}{misc}"
          />
          <div className="flex flex-row gap-2">
            <Button
              variant="accent"
              size="sm"
              onClick={renameFiles}
              disabled={renaming || !selected}
            >
              {renaming ? "Checking..." : "Preview Renames"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRenameDryRun(false);
                renameFiles();
              }}
              disabled={renaming || !selected}
              title="Apply renames immediately"
            >
              Apply Renames
            </Button>
            <label className="flex flex-row items-center gap-1 text-xs text-muted ml-auto">
              <input
                type="checkbox"
                checked={renameDryRun}
                onChange={(e) => setRenameDryRun(e.target.checked)}
              />
              Preview only
            </label>
          </div>
          {renameResult && (
            <pre className="text-xs text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
              {renameResult}
            </pre>
          )}
        </div>
      </Section>

      {editing && selected && (
        <Modal header={`Edit: ${selected}`} onClose={() => setEditing(false)}>
          <PlaylistEditor
            key={selected}
            selectedPlaylist={selected}
            onClose={() => setEditing(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border p-3 rounded">
      <h3 className="font-bold text-sm mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default PlaylistSettings;
