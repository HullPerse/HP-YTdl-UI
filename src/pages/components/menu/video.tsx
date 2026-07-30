import { useState, useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/button";
import { Input } from "@/components/input";
import { Download, ExternalLink, Loader2, Check, X } from "lucide-react";
import type { SearchResult, QueueItemData } from "@/types";
import type { VariantProps } from "class-variance-authority";

const TEMPLATE_KEY = "filenameTemplate";

function VideoPage({ query, searchKey }: { query: string; searchKey: number }) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [format, setFormat] = useState<"audio" | "video">("audio");
  const [quality, setQuality] = useState(
    () => localStorage.getItem("defaultQuality") || "720",
  );
  const [template, setTemplate] = useState(
    () => localStorage.getItem(TEMPLATE_KEY) || "{artist} - {title}{misc}",
  );
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);
  const prevSearchKey = useRef(0);

  useEffect(() => {
    if (searchKey !== prevSearchKey.current && query.trim()) {
      prevSearchKey.current = searchKey;
      doSearch(query);
    }
  }, [searchKey]);

  useEffect(() => {
    if (!queuedId) return;
    const es = new EventSource("/api/queue/progress");
    es.onmessage = (e) => {
      try {
        const items: QueueItemData[] = JSON.parse(e.data);
        const mine = items.find((i) => i.id === queuedId);
        if (!mine) return;
        if (mine.status === "completed") {
          setQueueStatus("Done!");
          es.close();
        } else if (mine.status === "failed") {
          setQueueStatus(`Failed: ${mine.error}`);
          es.close();
        } else if (mine.status === "downloading")
          setQueueStatus(`${mine.progress.toFixed(1)}%`);
        else if (mine.status === "conflict") {
          setQueueStatus("File exists");
          es.close();
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [queuedId]);

  async function doSearch(q: string) {
    setLoading(true);
    setResults([]);
    try {
      const res = await fetch(
        `/api/search?query=${encodeURIComponent(q.trim())}&max_results=8`,
      );
      const d = await res.json();
      setResults(d.results || []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }

  function selectResult(r: SearchResult) {
    setSelected(r);
    setShowPreview(true);
    setQueuedId(null);
    setQueueStatus("");
  }

  function closePreview() {
    setShowPreview(false);
    setSelected(null);
    setQueuedId(null);
    setQueueStatus("");
  }

  function downloadThumb(r: SearchResult) {
    fetch(r.thumbnail)
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${r.id}.jpg`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => {});
  }

  function getFilename(): string {
    const parts = selected!.title.split(" - ");
    const artist = parts.length > 1 ? parts.slice(0, -1).join(" - ") : "";
    const title = parts.length > 1 ? parts[parts.length - 1]! : selected!.title;
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
    const safeArtist = artist.replace(/[\\/:*?"<>|]/g, "_");
    return (
      template
        .replace("{artist}", safeArtist)
        .replace("{title}", safeTitle)
        .replace("{misc}", "")
        .replace("{channel}", selected!.channel || "")
        .replace("{id}", selected!.id)
        .replace("{ext}", format === "audio" ? "mp3" : "mp4")
        .replace("{playlist}", "")
        .replace("{quality}", quality)
        .replace("{source_title}", selected!.title)
        .replace(/\s+/g, " ")
        .trim() || "untitled"
    );
  }

  async function queueDownload() {
    if (!selected) return;
    setQueueStatus("Adding...");
    try {
      const res = await fetch("/api/queue/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: selected.url,
          filename: getFilename(),
          fmt: format === "audio" ? "mp3" : "mp4",
          quality,
          playlist: "",
          output_dir: localStorage.getItem("outputDir") || "",
          include_thumbnail: false,
        }),
      });
      const d = await res.json();
      setQueuedId(d.item_id);
      setQueueStatus("Queued");
    } catch {
      setQueueStatus("Failed to queue");
    }
  }

  return (
    <div className="flex flex-col p-2 gap-2">
      {results.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {results.map((r) => (
            <div
              key={r.id}
              className="border border-border rounded overflow-hidden group"
            >
              <div className="relative aspect-video bg-accent">
                <img
                  src={r.thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                />
                {r.duration != null && (
                  <span className="absolute bottom-1 right-1 bg-black/70 text-xs px-1 rounded">
                    {Math.floor(r.duration / 60)}:
                    {String(r.duration % 60).padStart(2, "0")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100"
                  onClick={() => downloadThumb(r)}
                  title="Download thumbnail"
                >
                  <Download className="size-3" />
                </Button>
              </div>
              <div className="p-2">
                <p className="text-sm font-medium line-clamp-2">{r.title}</p>
                <p className="text-xs text-muted truncate">{r.channel}</p>
                <Button
                  variant="accent"
                  size="sm"
                  className="mt-1 w-full"
                  onClick={() => selectResult(r)}
                >
                  Select
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center p-8 text-muted">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {!loading && results.length === 0 && query.trim() && (
        <p className="text-center text-muted p-4">No results found</p>
      )}

      {showPreview && selected && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={closePreview}
        >
          <div
            className="bg-background border-2 border-border w-full max-w-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-row items-center justify-between p-2 border-b-2 border-border">
              <span className="font-bold truncate flex-1">
                {selected.title}
              </span>
              <Button
                variant="error"
                size="icon"
                className="size-8"
                onClick={closePreview}
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="relative aspect-video bg-accent">
              <iframe
                src={`https://www.youtube.com/embed/${selected.id}?autoplay=0`}
                allow="encrypted-media; picture-in-picture"
                className="w-full h-full"
                title="Preview"
              />
            </div>

            <div className="p-3 flex flex-col gap-3">
              <a
                href={selected.url}
                target="_blank"
                className="flex items-center gap-1 text-primary text-xs hover:underline"
              >
                <ExternalLink className="size-3" /> Open on YouTube
              </a>

              <Input
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  localStorage.setItem(TEMPLATE_KEY, e.target.value);
                }}
                placeholder="Filename template"
              />

              <div className="flex flex-row gap-1">
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

              <Button
                variant={
                  (() => {
                    if (queuedId && queueStatus === "Done!") return "success";
                    else if (queueStatus) return "error";
                    else return "accent";
                  })() as keyof typeof buttonVariants
                }
                onClick={queueDownload}
                disabled={!!queuedId}
                className={queueStatus === "Done!" ? "bg-success!" : ""}
                title={
                  queuedId && queueStatus === "Done!"
                    ? "Downloaded"
                    : queueStatus || "Download"
                }
              >
                {queuedId && queueStatus === "Done!" ? (
                  <Check className="size-4" />
                ) : null}

                {queuedId && queueStatus === "Done!"
                  ? "Downloaded"
                  : queueStatus
                    ? "Error"
                    : "Download"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoPage;
