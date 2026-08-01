import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface DownloadAllOptions {
  format: "audio" | "video";
  quality: string;
  template: string;
  skipExisting: boolean;
}

function DownloadAllModal({
  playlistName,
  tracks,
  startIndex,
  onConfirm,
  onCancel,
}: {
  playlistName: string;
  tracks: string[];
  startIndex: number;
  onConfirm: (options: DownloadAllOptions) => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState<"audio" | "video">("audio");
  const [quality, setQuality] = useState(
    () => localStorage.getItem("defaultQuality") || "720",
  );
  const [template, setTemplate] = useState(
    () =>
      localStorage.getItem("filenameTemplate") || "{artist} - {title}{misc}",
  );
  const [skipExisting, setSkipExisting] = useState(true);

  const { data: existing, isLoading } = useQuery<{ existing: number[] }>({
    queryKey: ["download-all-existing", playlistName, template],
    queryFn: () =>
      fetch("/api/playlists/check-existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks, template }),
      }).then((r) => r.json()),
    enabled: !!playlistName && tracks.length > 0,
  });

  const skipCount =
    existing?.existing.filter((i) => i >= startIndex).length ?? 0;
  const remaining = tracks.length - startIndex;
  const toDownload = Math.max(0, remaining - (skipExisting ? skipCount : 0));

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-row gap-2 items-start border border-border p-2 bg-accent/30">
        <AlertTriangle className="size-5 shrink-0 text-primary mt-0.5" />
        <p className="text-sm text-muted">
          Download All will download the{" "}
          <span className="font-bold text-text">FIRST search result</span> for
          each track. Some downloads may not match the intended track - review
          results before trusting them.
        </p>
      </div>

      <div className="flex flex-row gap-2 items-center">
        <span className="text-xs text-muted shrink-0">Format:</span>
        <Button
          variant={format === "audio" ? "accent" : "outline"}
          size="sm"
          onClick={() => setFormat("audio")}
        >
          MP3
        </Button>
        <Button
          variant={format === "video" ? "accent" : "outline"}
          size="sm"
          onClick={() => setFormat("video")}
        >
          MP4
        </Button>
      </div>

      {format === "video" && (
        <div className="flex flex-row flex-wrap gap-1">
          {["144", "360", "480", "720", "1080", "2160"].map((q) => (
            <Button
              key={q}
              variant={quality === q ? "accent" : "outline"}
              size="sm"
              onClick={() => setQuality(q)}
            >
              {q}p
            </Button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Filename template</span>
        <Input
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            localStorage.setItem("filenameTemplate", e.target.value);
          }}
          className="p-1 text-sm"
        />
      </label>

      <label className="flex flex-row items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={skipExisting}
          onChange={(e) => setSkipExisting(e.target.checked)}
          className="size-4 cursor-pointer"
        />
        <span className="text-sm">
          Skip already-downloaded tracks
          {isLoading ? (
            <Loader2 className="size-3 inline animate-spin ml-1" />
          ) : skipCount > 0 ? (
            <span className="text-muted text-xs"> ({skipCount})</span>
          ) : null}
        </span>
      </label>

      <p className="text-xs text-muted">
        Start from track {startIndex + 1} · {remaining} remaining
        {skipExisting && skipCount > 0
          ? ` · ~${toDownload} will download`
          : ""}
      </p>

      <div className="flex flex-row justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="accent"
          size="sm"
          onClick={() =>
            onConfirm({ format, quality, template, skipExisting })
          }
          disabled={toDownload <= 0}
        >
          Start Download All
        </Button>
      </div>
    </div>
  );
}

export default DownloadAllModal;
