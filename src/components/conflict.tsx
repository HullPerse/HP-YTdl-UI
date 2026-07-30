import type { QueueItemData } from "@/types";
import { Button } from "@/components/button";

interface ConflictModalProps {
  item: QueueItemData;
  onResolve: (id: string, action: "overwrite" | "skip") => void;
}

function ConflictModal({ item, onResolve }: ConflictModalProps) {
  return (
    <div className="fixed inset-0 z-50000 bg-black/50 flex items-center justify-center">
      <div className="bg-background border-2 border-border p-4 w-80">
        <p className="font-bold mb-2">File Conflict</p>
        <p className="text-sm text-muted mb-3">
          {item.filename} already exists
        </p>
        <div className="flex flex-row gap-2">
          <Button
            variant="accent"
            size="sm"
            onClick={() => onResolve(item.id, "overwrite")}
          >
            Overwrite
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResolve(item.id, "skip")}
          >
            Skip
          </Button>
          <Button
            variant="error"
            size="sm"
            onClick={() => onResolve(item.id, "skip")}
            className="ml-auto"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConflictModal;
