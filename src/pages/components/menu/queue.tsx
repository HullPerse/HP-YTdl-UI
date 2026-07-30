import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import ConflictModal from "@/components/conflict";
import {
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  Circle,
  ArrowDownCircle,
  CheckCircle,
  XCircle,
  MinusCircle,
  AlertTriangle,
} from "lucide-react";
import type { QueueItemData } from "@/types";

const STATUS_ICONS: Record<string, typeof Circle> = {
  waiting: Circle,
  downloading: ArrowDownCircle,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: MinusCircle,
  conflict: AlertTriangle,
};

function StatusIcon({ status }: { status: string }) {
  const Icon = STATUS_ICONS[status];
  if (!Icon) return <span className="size-3">?</span>;
  return <Icon className="size-3" />;
}

function QueuePage() {
  const [items, setItems] = useState<QueueItemData[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/queue/progress");
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        setItems(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const activeCount = items.filter(
    (i) => i.status === "waiting" || i.status === "downloading",
  ).length;
  const conflictItem = items.find((i) => i.status === "conflict");

  const removeMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/queue/${id}`, { method: "DELETE" }),
  });

  const reorderMutation = useMutation({
    mutationFn: (body: { id: string; new_index: number }) =>
      fetch("/api/queue/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  });

  const clearMutation = useMutation({
    mutationFn: () => fetch("/api/queue/clear", { method: "POST" }),
  });

  const resolveMutation = useMutation({
    mutationFn: (body: { id: string; action: string }) =>
      fetch(`/api/queue/resolve/${body.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: body.action }),
      }),
  });

  return (
    <div className="flex flex-col p-2 gap-1">
      <div className="flex flex-row items-center justify-between border-b border-border pb-1 mb-1">
        <span className="text-xs text-muted">
          {items.length} item(s) — {activeCount} active
          {!connected && (
            <span className="text-error ml-1">(disconnected)</span>
          )}
        </span>
        {items.some(
          (i) =>
            i.status === "completed" ||
            i.status === "failed" ||
            i.status === "cancelled",
        ) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearMutation.mutate()}
          >
            <X className="size-3" /> Clear
          </Button>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-center text-muted p-4 text-sm">Queue is empty</p>
      )}

      {items.map((item, idx) => (
        <div
          key={item.id}
          className={`flex flex-row items-center gap-2 p-2 border border-border text-sm ${statusClass(item.status)}`}
        >
          <div className="flex flex-col gap-0">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={idx === 0 || item.status !== "waiting"}
              onClick={() =>
                reorderMutation.mutate({ id: item.id, new_index: idx - 1 })
              }
            >
              <ArrowUp className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={idx === items.length - 1 || item.status !== "waiting"}
              onClick={() =>
                reorderMutation.mutate({ id: item.id, new_index: idx + 1 })
              }
            >
              <ArrowDown className="size-3" />
            </Button>
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate font-medium">{escapeHtml(item.filename)}</p>
            <p className="text-xs text-muted  flex flex-row gap-1 items-center">
              <StatusIcon status={item.status} /> {item.status}
            </p>
            {item.status === "downloading" && item.progress > 0 && (
              <div className="w-full h-1 bg-accent mt-1 rounded overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${item.progress}%` }}
                />
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
          <Button
            variant="error"
            size="icon-sm"
            className="size-7"
            onClick={() => removeMutation.mutate(item.id)}
            disabled={item.status === "completed"}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}

      {conflictItem && (
        <ConflictModal
          item={conflictItem}
          onResolve={(id, action) => resolveMutation.mutate({ id, action })}
        />
      )}
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case "completed":
      return "opacity-60";
    case "failed":
      return "border-error/30";
    case "conflict":
      return "border-yellow-500/50";
    default:
      return "";
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
