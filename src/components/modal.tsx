import type { ReactNode } from "react";
import { Button } from "./button";
import { Settings, X } from "lucide-react";

function Modal({
  header,
  children,
  onClose,
}: {
  header: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <main
      className="absolute left-1/2 top-1/2 -translate-1/2 h-screen w-screen z-40000 bg-black/50 items-center justify-center flex"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-3xl min-h-64 h-fit bg-background border-2 border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/*HEADER*/}
        <section className="flex flex-row items-center h-16 w-full bg-background border-b-2 border-border p-2">
          <span className="flex-1 flex flex-row gap-1 items-center font-bold">
            <Settings className="size-5" />
            {header}
          </span>
          <Button
            size="icon"
            variant="error"
            className="size-12"
            onClick={() => onClose()}
            disabled={!onClose}
          >
            <X />
          </Button>
        </section>
        {/*BODY*/}
        <section>{children}</section>
      </div>
    </main>
  );
}

export default Modal;
