"use client";

/**
 * SelectionActions — contextual action bar shown when objects are selected
 * (opened from the toolbar's Select tool button).
 *
 * Provides: duplicate, copy, paste, color change, delete, and Solve (math).
 *
 * NOTE: No tooltips — buttons never show a label popup on tap/hover.
 */

import React, { useState } from "react";
import {
  X,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Palette,
  Sigma,
} from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COLOR_SWATCHES = [
  "#111111", "#525252", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#ec4899",
];

export function SelectionActions({ onClose }: { onClose: () => void }) {
  const selection = useCanvasStore((s) => s.selection);
  const duplicateSelection = useCanvasStore((s) => s.duplicateSelection);
  const copySelection = useCanvasStore((s) => s.copySelection);
  const paste = useCanvasStore((s) => s.paste);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);
  const setSelectionColor = useCanvasStore((s) => s.setSelectionColor);
  const solveSelection = useCanvasStore((s) => s.solveSelection);
  const objects = useCanvasStore((s) => s.objects);
  const [showColors, setShowColors] = useState(false);

  const selectedObjects = objects.filter((o) => selection.ids.includes(o.id));

  const onSolve = () => {
    // Always uses OCR-based solve — works for handwritten strokes AND typed text
    solveSelection();
    onClose();
  };

  return (
    <div className="bg-background/95 backdrop-blur rounded-2xl shadow-xl border border-border/60 p-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={duplicateSelection}>
          <CopyPlus className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={copySelection}>
          <Copy className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={paste}>
          <ClipboardPaste className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-border mx-0.5" />

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9 rounded-lg", showColors && "bg-accent")}
          onClick={() => setShowColors((v) => !v)}
        >
          <Palette className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-border mx-0.5" />

        <Button
          variant="default"
          size="sm"
          className="h-9 gap-1.5 px-3 rounded-lg"
          onClick={onSolve}
        >
          <Sigma className="h-4 w-4" />
          <span className="text-xs font-medium">Solve</span>
        </Button>

        <div className="h-6 w-px bg-border mx-0.5" />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg text-destructive hover:bg-destructive/10"
          onClick={deleteSelection}
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {showColors && (
        <div className="mt-2 pt-2 border-t border-border/60 flex items-center gap-1.5 flex-wrap">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              className="h-6 w-6 rounded-full border-2 border-border hover:scale-110 transition-transform"
              style={{ background: c }}
              onClick={() => {
                setSelectionColor(c);
                setShowColors(false);
              }}
            />
          ))}
          <Input
            type="color"
            className="h-6 w-8 p-0 border-0 cursor-pointer"
            onChange={(e) => setSelectionColor(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
