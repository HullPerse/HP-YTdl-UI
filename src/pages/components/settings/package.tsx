import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Loader2 } from "lucide-react";
import type { YtdlpVersionResult, YtdlpUpdateResult } from "@/types";

function PackageSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<YtdlpVersionResult>({
    queryKey: ["ytdlp-version"],
    queryFn: () => fetch("/api/ytdlp/version").then((r) => r.json()),
    staleTime: 60_000,
  });

  const updateMutation = useMutation<YtdlpUpdateResult>({
    mutationFn: () =>
      fetch("/api/ytdlp/update", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ytdlp-version"] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Section title="yt-dlp Version">
        {isLoading ? (
          <p className="text-muted text-sm">
            <Loader2 className="size-4 inline animate-spin" /> Loading...
          </p>
        ) : data ? (
          <div className="text-sm space-y-1">
            <p>
              Installed:{" "}
              <span className="font-bold">{data.version || "N/A"}</span>
            </p>
            <p>
              Latest:{" "}
              <span className="font-bold">{data.latest || "N/A"}</span>
            </p>
            {data.update_available && (
              <p className="text-error">Update available!</p>
            )}
            {data.frozen && (
              <p className="text-muted text-xs mt-2">
                yt-dlp is bundled with this app. Download a new release to
                update.
              </p>
            )}
          </div>
        ) : (
          <p className="text-error text-sm">Failed to load version info</p>
        )}

        <div className="flex flex-row gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["ytdlp-version"] })
            }
            disabled={isLoading}
          >
            Check for Updates
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || data?.frozen}
          >
            {updateMutation.isPending ? "Updating..." : "Update yt-dlp"}
          </Button>
        </div>

        {updateMutation.data && (
          <div className="mt-2 text-xs">
            {updateMutation.data.updated ? (
              <p className="text-success">
                Updated to version {updateMutation.data.version}
              </p>
            ) : (
              <p className="text-error">{updateMutation.data.error}</p>
            )}
          </div>
        )}
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

export default PackageSettings;
