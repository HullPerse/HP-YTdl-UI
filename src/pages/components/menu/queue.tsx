import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/button";
import { Loader2, Trash2, ArrowUp, ArrowDown, X } from "lucide-react";
import type { QueueItemData } from "@/types";

const STATUS_ICONS: Record<string, string> = {
  waiting: "\u25A0",
  downloading: "\u25B6",
  completed: "\u2713",
  failed: "\u2717",
  cancelled: "\u2013",
  conflict: "\u26A0",
};

function QueuePage() {
  const [items, setItems] = useState<QueueItemData[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/queue/progress");
    es.onopen = () => setConnected(true);
    es.onmessage = e => {
      try { setItems(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const activeCount = items.filter(i => i.status === "waiting" || i.status === "downloading").length;
  const conflictItem = items.find(i => i.status === "conflict");

  async function remove(id: string) {
    await fetch(`/api/queue/${id}`, { method: "DELETE" });
  }

  async function reorder(id: string, direction: -1 | 1) {
    const idx = items.findIndex(i => i.id === id);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;
    await fetch("/api/queue/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, new_index: newIdx }),
    });
  }

  async function clearCompleted() {
    await fetch("/api/queue/clear", { method: "POST" });
  }

  async function resolveConflict(id: string, action: string) {
    await fetch(`/api/queue/resolve/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  }

  return (
    <div className="flex flex-col p-2 gap-1">
      <div className="flex flex-row items-center justify-between border-b border-border pb-1 mb-1">
        <span className="text-xs text-muted">
          {items.length} item(s) — {activeCount} active
          {!connected && <span className="text-error ml-1">(disconnected)</span>}
        </span>
        {items.some(i => i.status === "completed" || i.status === "failed" || i.status === "cancelled") && (
          <Button variant="ghost" size="sm" onClick={clearCompleted}><X className="size-3" /> Clear</Button>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-center text-muted p-4 text-sm">Queue is empty</p>
      )}

      {items.map((item, idx) => (
        <div key={item.id} className={`flex flex-row items-center gap-2 p-2 border border-border text-sm ${statusClass(item.status)}`}>
          <div className="flex flex-col gap-0">
            <Button variant="ghost" size="icon-sm" disabled={idx === 0 || item.status !== "waiting"}
              onClick={() => reorder(item.id, -1)}><ArrowUp className="size-3" /></Button>
            <Button variant="ghost" size="icon-sm" disabled={idx === items.length - 1 || item.status !== "waiting"}
              onClick={() => reorder(item.id, 1)}><ArrowDown className="size-3" /></Button>
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate font-medium">{escapeHtml(item.filename)}</p>
            <p className="text-xs text-muted">{STATUS_ICONS[item.status] || "?"} {item.status}</p>
            {item.status === "downloading" && item.progress > 0 && (
              <div className="w-full h-1 bg-accent mt-1 rounded overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${item.progress}%` }} />
              </div>
            )}
            {item.status === "downloading" && (
              <p className="text-xs text-muted">
                {item.progress.toFixed(1)}%
                {item.speed > 0 && ` · ${formatSpeed(item.speed)}`}
                {item.eta > 0 && ` · ETA ${item.eta}s`}
              </p>
            )}
          </div>
          <Button variant="error" size="icon-sm" className="size-7"
            onClick={() => remove(item.id)}
            disabled={item.status === "completed"}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}

      {conflictItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-background border-2 border-border p-4 w-80">
            <p className="font-bold mb-2">File Conflict</p>
            <p className="text-sm text-muted mb-3">{escapeHtml(conflictItem.filename)} already exists</p>
            <div className="flex flex-row gap-2">
              <Button variant="accent" size="sm" onClick={() => resolveConflict(conflictItem.id, "overwrite")}>Overwrite</Button>
              <Button variant="outline" size="sm" onClick={() => resolveConflict(conflictItem.id, "skip")}>Skip</Button>
              <Button variant="ghost" size="sm" onClick={() => resolveConflict(conflictItem.id, "skip")} className="ml-auto">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case "completed": return "opacity-60";
    case "failed": return "border-error/30";
    case "conflict": return "border-yellow-500/50";
    default: return "";
  }
}

function formatSpeed(speed: number): string {
  if (speed > 1_000_000) return `${(speed / 1_000_000).toFixed(1)} MB/s`;
  if (speed > 1_000) return `${(speed / 1_000).toFixed(0)} KB/s`;
  return `${speed.toFixed(0)} B/s`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(s));
  return div.innerHTML;
}

export default QueuePage;
