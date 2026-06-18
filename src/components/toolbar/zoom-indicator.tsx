"use client";

/**
 * ZoomIndicator — badge showing the current zoom percentage + a lock toggle.
 * Tap the percentage to reset to 100%.
 * Tap the lock icon to lock/unlock zoom (when locked, pinch/wheel only pans).
 *
 * Positioned at bottom-right.
 */

import React from "react";
import { Maximize2, Lock, Unlock } from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { cn } from "@/lib/utils";

export function ZoomIndicator() {
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const zoomLocked = useCanvasStore((s) => s.zoomLocked);
  const toggleZoomLock = useCanvasStore((s) => s.toggleZoomLock);

  const pct = Math.round(viewport.scale * 100);

  const resetZoom = () => {
    if (zoomLocked) return; // can't reset when locked
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const worldX = (cx - viewport.x) / viewport.scale;
    const worldY = (cy - viewport.y) / viewport.scale;
    setViewport({
      scale: 1,
      x: cx - worldX,
      y: cy - worldY,
    });
  };

  return (
    <div
      className={cn(
        "absolute bottom-6 right-4 z-30 flex items-center gap-0.5 p-1 rounded-full",
        "bg-background/80 backdrop-blur shadow-md border border-border/60",
      )}
    >
      <button
        onClick={resetZoom}
        disabled={zoomLocked}
        className={cn(
          "h-7 min-w-[3rem] px-2 rounded-full text-xs font-semibold tabular-nums",
          "flex items-center justify-center gap-1 transition-colors",
          zoomLocked
            ? "opacity-50 cursor-not-allowed"
            : "hover:bg-accent",
          pct === 100 && !zoomLocked && "text-muted-foreground",
        )}
      >
        {pct === 100 && !zoomLocked ? (
          <>
            <Maximize2 className="h-3 w-3" />
            100%
          </>
        ) : (
          <>{pct}%</>
        )}
      </button>

      <button
        onClick={toggleZoomLock}
        className={cn(
          "h-7 w-7 rounded-full flex items-center justify-center transition-colors",
          "hover:bg-accent",
          zoomLocked && "bg-primary/15 text-primary",
        )}
        title={zoomLocked ? "Unlock zoom" : "Lock zoom"}
      >
        {zoomLocked ? (
          <Lock className="h-3.5 w-3.5" />
        ) : (
          <Unlock className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
