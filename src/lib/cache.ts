import { LRUCache } from "lru-cache";
import type { SearchResult, MetadataResult, PlaylistInfo } from "@/types";

export const searchCache = new LRUCache<string, { results: SearchResult[]; timestamp: number }>({
  max: 100,
  ttl: 1000 * 60 * 5,
});

export const metadataCache = new LRUCache<string, MetadataResult>({
  max: 50,
  ttl: 1000 * 60 * 10,
});

export const playlistCache = new LRUCache<string, PlaylistInfo[]>({
  max: 10,
  ttl: 1000 * 30,
});
