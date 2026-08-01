import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { menuTabs } from "@/config";
import type { MenuTab, PlaylistInfo } from "@/types";
import { ClipboardPaste, Search, Settings, X } from "lucide-react";
import VideoPage from "./components/menu/video";
import PlaylistPage from "./components/menu/playlist";
import QueuePage from "./components/menu/queue";
import { useQueueItems } from "@/lib/useQueueItems";
import AppVersionBadge from "@/components/version";

const RECENT_KEY = "recentSearches";

function MenuPage({ setSettings }: { setSettings: (value: boolean) => void }) {
  const [currentTab, setCurrentTab] = useState<MenuTab>("video");
  const [value, setValue] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [showRecent, setShowRecent] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { items: queueItems, connected: queueConnected } = useQueueItems();

  const activeQueueCount = queueItems.filter(
    (i) => i.status === "waiting" || i.status === "downloading",
  ).length;

  const { data } = useQuery<PlaylistInfo[]>({
    queryKey: ["playlists"],
    queryFn: () => fetch("/api/playlists").then((r) => r.json()),
    enabled: currentTab === "playlist",
    staleTime: 10_000,
  });

  const playlists = Array.isArray(data) ? data : [];

  useEffect(() => {
    const es = new EventSource("/api/events/playlists");
    es.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    };
    return () => es.close();
  }, [queryClient]);

  const handlePaste = useCallback(async () => {
    const data = await navigator.clipboard.readText();
    if (!data) return;
    setValue(data.trim());
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    (q: string) => {
      if (!q.trim()) return;
      setSearchKey((k) => k + 1);
      const updated = [
        q.trim(),
        ...recentSearches.filter((s) => s !== q.trim()),
      ].slice(0, 5);
      setRecentSearches(updated);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    },
    [recentSearches],
  );

  const handleEnter = useCallback(() => {
    if (value.trim()) doSearch(value);
  }, [value, doSearch]);

  const removeRecent = useCallback(
    (i: number) => {
      const updated = recentSearches.filter((_, j) => j !== i);
      setRecentSearches(updated);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    },
    [recentSearches],
  );

  const clickRecent = useCallback(
    (s: string) => {
      setValue(s);
      doSearch(s);
    },
    [doSearch],
  );

  return (
    <main className="flex flex-col h-full">
      <div className="flex flex-row items-center justify-between p-2 border-b-2 border-border gap-2">
        {currentTab === "video" && (
          <div className="flex flex-row gap-0 w-full relative">
            <Button
              className="flex flex-row w-20 h-10 text-muted border-2 border-r-0 items-center gap-1 shrink-0"
              variant="outline"
              onClick={handlePaste}
            >
              <ClipboardPaste />
              Paste
            </Button>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste URL or search by title..."
              className="flex-1 p-2 bg-accent placeholder:text-muted text-text border-0 outline-0"
              onFocus={() => setShowRecent(true)}
              onBlur={() => setTimeout(() => setShowRecent(false), 200)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEnter();
              }}
            />
            <Button
              variant="accent"
              className="h-10 rounded-none shrink-0"
              onClick={() => doSearch(value)}
            >
              <Search className="size-4" />
            </Button>
            {showRecent && recentSearches.length > 0 && (
              <div className="absolute top-full left-20 right-0 bg-accent border border-border z-50">
                {recentSearches.map((s, i) => (
                  <div
                    key={i}
                    className="flex flex-row items-center p-2 hover:bg-white/5 cursor-pointer text-sm"
                    onMouseDown={() => clickRecent(s)}
                  >
                    <span className="flex-1 truncate">{s}</span>
                    <X
                      className="size-3 text-muted shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(i);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {currentTab === "playlist" && (
          <select
            value={selectedPlaylist}
            onChange={(e) => setSelectedPlaylist(e.target.value)}
            className="flex-1 h-10 bg-accent text-text px-2 border-0 outline-0 cursor-pointer"
          >
            <option value="">Select playlist...</option>
            {playlists.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.count})
              </option>
            ))}
          </select>
        )}

        <AppVersionBadge />
        <Button
          variant="outline"
          size="icon"
          className="size-10 ml-auto shrink-0"
          onClick={() => setSettings(true)}
        >
          <Settings />
        </Button>
      </div>

      <section className="p-1 flex flex-row gap-1 w-full items-center border-b-2 border-border shrink-0">
        {menuTabs.map((tab) => {
          const isActive = currentTab === tab;
          const title =
            tab === "queue" && activeQueueCount > 0
              ? `Queue (${activeQueueCount})`
              : tab.charAt(0).toUpperCase() + tab.slice(1);
          return (
            <Button
              key={tab}
              variant={isActive ? "accent" : "outline"}
              onClick={() => {
                setCurrentTab(tab);
                setShowRecent(false);
              }}
              className="h-10 w-20"
              disabled={isActive}
            >
              {title}
            </Button>
          );
        })}
      </section>

      <section className="flex-1 overflow-y-auto">
        <div className={currentTab === "video" ? "" : "hidden"}>
          <VideoPage query={value} searchKey={searchKey} />
        </div>
        <div className={currentTab === "playlist" ? "" : "hidden"}>
          <PlaylistPage selectedPlaylist={selectedPlaylist} />
        </div>
        <div className={currentTab === "queue" ? "" : "hidden"}>
          <QueuePage items={queueItems} connected={queueConnected} />
        </div>
      </section>
    </main>
  );
}

export default MenuPage;
