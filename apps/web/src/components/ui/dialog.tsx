import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-lg">
        <div className="flex flex-col gap-2">
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
