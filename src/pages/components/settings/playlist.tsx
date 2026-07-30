import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type { PlaylistInfo } from "@/types";

function PlaylistSettings() {
  const [selected, setSelected] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameResult, setRenameResult] = useState("");
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
    mutationFn: (body: { url: string; name: string }) =>
      fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
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
        { method: "POST" },
      );
      const d = await res.json();
      const lines = [
        ...(d.renamed || []).map(
          (r: { old: string; new: string }) => `${r.old} → ${r.new}`,
        ),
        ...(d.errors || []).map((e: string) => `Error: ${e}`),
      ];
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
              placeholder="YouTube playlist URL"
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
            disabled={
              importing || !importUrl.trim() || !importName.trim()
            }
          >
            {importing ? "Importing..." : "Import"}
          </Button>
          {importResult && (
            <p className="text-xs text-muted">{importResult}</p>
          )}
        </div>
      </Section>

      <Section title="Rename Downloaded Files">
        <div className="flex flex-col gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-accent text-text p-2 border border-border"
          >
            <option value="">Select a playlist...</option>
            {playlists.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.count} tracks)
              </option>
            ))}
          </select>
          <Button
            variant="accent"
            size="sm"
            onClick={renameFiles}
            disabled={renaming || !selected}
          >
            {renaming ? "Renaming..." : "Rename Files"}
          </Button>
          {renameResult && (
            <pre className="text-xs text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
              {renameResult}
            </pre>
          )}
        </div>
      </Section>
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
