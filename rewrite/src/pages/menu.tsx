import { Button } from "@/components/button";
import { menuTabs } from "@/config";
import type { MenuTab } from "@/types";
import { ClipboardPaste, Settings } from "lucide-react";
import { useState } from "react";

function MenuPage({ setSettings }: { setSettings: (value: boolean) => void }) {
  const [currentTab, setCurrentTab] = useState<MenuTab>("video");
  const [value, setValue] = useState<string>("");

  const getPlaceholder = () => {
    const placeholderMap = {
      video: "Paste URL or search by title...",
      playlist: "Paste Playlist URL or choose existing one...",
    } as Record<Partial<MenuTab>, string>;

    return placeholderMap[currentTab];
  };

  return (
    <main>
      <div className="flex flex-row items-center justify-between p-2 border-b-2 border-border gap-2">
        {currentTab !== "queue" && (
          <div className="flex flex-row gap-0 w-full">
            <Button
              className="flex flex-row w-20 h-10 text-muted border-2 border-r-0 items-center gap-1"
              variant="outline"
              onClick={async () => {
                const data = await navigator.clipboard.readText();

                if (!data) return;
                else setValue(data.trim());
              }}
            >
              <ClipboardPaste />
              Paste
            </Button>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={getPlaceholder()}
              className="flex-1 p-2 bg-accent placeholder:text-muted text-text border-0 outline-0"
              onKeyDown={(e) => {
                if (e.key === "Enter") return console.log("penis");
              }}
            />
          </div>
        )}

        <Button
          variant="outline"
          size="icon"
          className="size-10 ml-auto"
          onClick={() => setSettings(true)}
        >
          <Settings />
        </Button>
      </div>
      {/*TABS*/}
      <section className="p-1 flex flex-row gap-1 w-full items-center border-b-2 border-border">
        {menuTabs.map((tab) => {
          const isActive = currentTab === tab;
          const title = tab.charAt(0).toUpperCase() + tab.slice(1);

          return (
            <Button
              key={tab}
              variant={isActive ? "accent" : "outline"}
              onClick={() => setCurrentTab(tab)}
              className="h-10 w-20"
              disabled={isActive}
            >
              {title}
            </Button>
          );
        })}
      </section>
    </main>
  );
}

export default MenuPage;
