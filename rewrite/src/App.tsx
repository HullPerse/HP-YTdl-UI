import { useState } from "react";
import type { MenuTab } from "./types";
import MenuPage from "./pages/menu";
import { Button } from "./components/button";
import { Settings } from "lucide-react";
import Modal from "./components/modal";

export function App() {
  const [menuTab, setMenuTab] = useState<MenuTab>("video");
  const [settings, setSettings] = useState<boolean>(false);

  return (
    <main
      className="flex justify-center w-screen h-screen bg-background text-text"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='42' height='44' viewBox='0 0 42 44' xmlns='http://www.w3.org/2000/svg'%3E%3Cg id='Page-1' fill='none' fill-rule='evenodd'%3E%3Cg id='brick-wall' fill='%23222222' fill-opacity='1'%3E%3Cpath d='M0 0h42v44H0V0zm1 1h40v20H1V1zM0 23h20v20H0V23zm22 0h20v20H22V23z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }}
    >
      {/* MENU */}
      <section className="relative flex flex-col w-6xl h-full bg-background border-accent border-x-2">
        <MenuPage setSettings={setSettings} />
      </section>

      {/* SETTINGS */}
      {settings && (
        <section className="absolute top-1/2 left-1/2 -translate-1/2">
          <Modal header="Settings" onClose={() => setSettings(false)}>
            1asdasdadasd
          </Modal>
        </section>
      )}
    </main>
  );
}

export default App;
