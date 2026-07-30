import { useState, useEffect } from "react";
import { Button } from "@/components/button";
import { Loader2 } from "lucide-react";
import type { YtdlpVersionResult, YtdlpUpdateResult } from "@/types";

function PackageSettings() {
  const [version, setVersion] = useState<YtdlpVersionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState<YtdlpUpdateResult | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => { checkVersion(); }, []);

  async function checkVersion() {
    setLoading(true);
    try {
      const res = await fetch("/api/ytdlp/version");
      const d = await res.json() as YtdlpVersionResult;
      setVersion(d);
    } catch { setVersion(null); }
    setLoading(false);
  }

  async function update() {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const res = await fetch("/api/ytdlp/update", { method: "POST" });
      const d = await res.json() as YtdlpUpdateResult;
      setUpdateResult(d);
      if (d.updated) checkVersion();
    } catch (e) {
      setUpdateResult({ updated: false, error: String(e) });
    }
    setUpdating(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="yt-dlp Version">
        {loading ? (
          <p className="text-muted text-sm"><Loader2 className="size-4 inline animate-spin" /> Loading...</p>
        ) : version ? (
          <div className="text-sm space-y-1">
            <p>Installed: <span className="font-bold">{version.version || "N/A"}</span></p>
            <p>Latest: <span className="font-bold">{version.latest || "N/A"}</span></p>
            {version.update_available && (
              <p className="text-error">Update available!</p>
            )}
            {version.frozen && (
              <p className="text-muted text-xs mt-2">yt-dlp is bundled with this app. Download a new release to update.</p>
            )}
          </div>
        ) : (
          <p className="text-error text-sm">Failed to load version info</p>
        )}

        <div className="flex flex-row gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={checkVersion} disabled={loading}>
            Check for Updates
          </Button>
          <Button variant="accent" size="sm" onClick={update} disabled={updating || version?.frozen}>
            {updating ? "Updating..." : "Update yt-dlp"}
          </Button>
        </div>

        {updateResult && (
          <div className="mt-2 text-xs">
            {updateResult.updated ? (
              <p className="text-success">Updated to version {updateResult.version}</p>
            ) : (
              <p className="text-error">{updateResult.error}</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border p-3 rounded">
      <h3 className="font-bold text-sm mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default PackageSettings;
