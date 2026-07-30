import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { cn } from "@/lib/cn";
import type { PlaylistInfo } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

function EditPlaylist({
  selectedPlaylist,
  currentTrack,
  setCurrentTrack,
  onClose,
}: {
  selectedPlaylist: string;
  currentTrack?: number;
  setCurrentTrack?: (value: number) => void;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();

  const [value, setValue] = useState<string>("");

  const { data, isLoading, isError, error } = useQuery<PlaylistInfo>({
    queryKey: ["editPlaylist", selectedPlaylist],
    queryFn: async (): Promise<PlaylistInfo> => {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}`,
      );

      if (!res.ok) throw new Error("Failed to fetch playlist");
      else return res.json();
    },
    enabled: !!selectedPlaylist,
  });

  const addMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/add`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );

      if (!res.ok) throw new Error("Failed to add tracks");
      else return res.json();
    },
    onSuccess: () => {
      setValue("");

      queryClient.invalidateQueries({
        queryKey: ["editPlaylist", selectedPlaylist],
      });

      queryClient.invalidateQueries({ queryKey: ["editPlaylist"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (index: number) => {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index }),
        },
      );

      if (!res.ok) throw new Error("Failed to delete track");
      else return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["editPlaylist", selectedPlaylist],
      });

      queryClient.invalidateQueries({ queryKey: ["editPlaylist"] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(selectedPlaylist)}/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to }),
        },
      );

      if (!res.ok) throw new Error("Failed to reorder track");
      else return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["editPlaylist", selectedPlaylist],
      });

      queryClient.invalidateQueries({ queryKey: ["editPlaylist"] });
    },
  });

  const handleAddTrack = () => {
    const url = value.trim();

    if (!url || addMutation.isPending) return;
    else return addMutation.mutate(url);
  };

  const handleDeleteTrack = (index: number) => {
    if (deleteMutation.isPending) return;
    else return deleteMutation.mutate(index);
  };

  const handleMoveTrack = (from: number, to: number) => {
    if (reorderMutation.isPending) return;
    else if (to < 0 || to >= (data?.tracks.length ?? 0)) return;
    else return reorderMutation.mutate({ from, to });
  };

  if (isLoading)
    return (
      <main className="flex flex-col w-full h-full items-center justify-center">
        <span className="text-center text-muted p-4">
          Loading playlist data...
        </span>
      </main>
    );

  if (isError)
    return (
      <main className="flex flex-col w-full h-full items-center justify-center">
        <span className="text-center text-muted p-4">
          Error while loading playlist data...
        </span>
        <span className="text-center text-red-500/50 p-4">{error.message}</span>
      </main>
    );

  const tracks = data?.tracks ?? [];

  const loading =
    isLoading ||
    addMutation.isPending ||
    deleteMutation.isPending ||
    reorderMutation.isPending;

  return (
    <main className="flex flex-col gap-1">
      {/*input*/}
      <section className="flex flex-row w-full p-2">
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") return handleAddTrack();
          }}
          placeholder="Paste URL..."
          className="flex-1 p-2 bg-accent placeholder:text-muted text-text border-0 outline-0"
          disabled={loading}
        />
        <Button
          variant="outline"
          size="icon"
          className="border-2"
          onClick={handleAddTrack}
          disabled={loading || !value.trim()}
        >
          {addMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
        </Button>
      </section>

      {/*tracks*/}
      <section className="flex flex-col gap-1 w-full max-h-120 p-1 overflow-auto">
        {tracks.length === 0 ? (
          <span className="p-4 text-center text-sm text-muted">
            No tracks in this laylist
          </span>
        ) : (
          tracks.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex flex-row items-center gap-1"
            >
              {/*TRACK*/}
              <section className="flex flex-row gap-1 border border-border flex-1 items-center">
                <span
                  className={cn(
                    "w-fit min-w-8 max-w-10 shrink-0 text-center text-xs h-7 flex items-center justify-center select-none",
                    currentTrack === index
                      ? "text-primary opacity-100 cursor-default"
                      : "text-muted hover:underline opacity-75 hover:opacity-100 cursor-pointer",
                  )}
                  title={`select track #${index}`}

                  onClick={() => {
                    if (currentTrack === index) return;
                    setCurrentTrack?.(index);
                    onClose?.();
                  }}
                  role="button"
                >
                  [ {index + 1} ]
                </span>
                <span className="flex-1 min-w-0 truncate text-sm" title={item}>
                  {item}
                </span>
              </section>
              {/*BUTTONS*/}
              <section className="flex flex-row gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={loading || index === 0}
                  onClick={() => handleMoveTrack(index, index - 1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={loading || index === tracks.length - 1}
                  onClick={() => handleMoveTrack(index, index + 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={loading}
                  onClick={() => handleDeleteTrack(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </section>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

export default EditPlaylist;
