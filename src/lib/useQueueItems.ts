import { useState, useEffect } from "react";
import type { QueueItemData } from "@/types";

export function useQueueItems() {
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

  return { items, connected };
}
