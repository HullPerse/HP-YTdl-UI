import { useState } from "react";
import { Button } from "@/components/button";
import { settingTabs } from "@/config";
import type { SettingsTab } from "@/types";
import GeneralSettings from "./components/settings/general";
import PlaylistSettings from "./components/settings/playlist";
import PackageSettings from "./components/settings/package";

function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="flex flex-col">
      <div className="flex flex-row p-1 gap-1 border-b-2 border-border">
        {settingTabs.map(t => (
          <Button
            key={t}
            variant={tab === t ? "accent" : "outline"}
            size="sm"
            onClick={() => setTab(t)}
            disabled={tab === t}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Button>
        ))}
      </div>
      <div className="p-4 overflow-y-auto max-h-[70vh]">
        {tab === "general" && <GeneralSettings />}
        {tab === "playlist" && <PlaylistSettings />}
        {tab === "package" && <PackageSettings />}
      </div>
    </div>
  );
}

export default SettingsPage;
