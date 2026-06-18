"use client";

/**
 * SelectionFloatingBar — floating action bar that appears above the
 * currently-selected object(s), in screen space.
 *
 * Buttons: Solve · Color · Duplicate · Copy · Delete
 *
 * The Solve button is ALWAYS visible. When tapped:
 *   - If the selection contains text objects, it extracts the text, sends it
 *     to the AI solver, and inserts the answer on the canvas to the right.
 *   - If no text is found (e.g. only strokes), it opens the Math Solver
 *     panel for manual input.
 *
 * Position: centered above the selection bounds. Auto-clamps to viewport
 * edges so it never goes off-screen.
 *
 * NOTE: No tooltips — buttons never show a label popup on tap/hover.
 */

import React, { useEffect, useState } from "react";
import {
  Sigma,
  Palette,
  CopyPlus,
  Copy,
  Trash2,
  Loader2,
  X,
} from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { objectBounds } from "@/lib/canvas/geometry";
import { HueWheelColorPicker } from "./hue-wheel-picker";

const COLOR_SWATCHES = [
  "#111111", "#525252", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#ec4899",
];

export function SelectionFloatingBar() {
  const selection = useCanvasStore((s) => s.selection);
  const objects = useCanvasStore((s) => s.objects);
  const viewport = useCanvasStore((s) => s.viewport);
  const tool = useCanvasStore((s) => s.tool);
  const editingTextId = useCanvasStore((s) => s.editingTextId);
  const isSolving = useCanvasStore((s) => s.isSolving);
  const duplicateSelection = useCanvasStore((s) => s.duplicateSelection);
  const copySelection = useCanvasStore((s) => s.copySelection);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);
  const setSelectionColor = useCanvasStore((s) => s.setSelectionColor);
  const solveSelection = useCanvasStore((s) => s.solveSelection);
  const [showColors, setShowColors] = useState(false);
  const [showCustomColor, setShowCustomColor] = useState(false);
  const [, forceTick] = useState(0);

  // Re-render on any store change so the bar tracks moving selections
  useEffect(() => {
    return useCanvasStore.subscribe(() => forceTick((t) => t + 1));
  }, []);

  // Don't show the bar while editing text (the textarea has its own UI)
  if (
    selection.ids.length === 0 ||
    tool !== "select" ||
    editingTextId !== null
  ) {
    return null;
  }

  // Compute screen-space bounds of the selection
  const selObjs = objects.filter((o) => selection.ids.includes(o.id));
  if (selObjs.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const o of selObjs) {
    const b = objectBounds(o);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!isFinite(minX)) return null;

  // Convert to screen space
  const screenMinX = minX * viewport.scale + viewport.x;
  const screenMaxX = maxX * viewport.scale + viewport.x;
  const screenMinY = minY * viewport.scale + viewport.y;
  const centerScreenX = (screenMinX + screenMaxX) / 2;

  // Position the bar above the selection AND above the rotate handle.
  // The rotate handle sits 24px above the selection bounds (center),
  // with a ~10px radius, so it spans screenMinY-34 to screenMinY-14.
  // The bar is ~46px tall. We place the bar 90px above the selection
  // so the bar bottom (at screenMinY-44) clears the handle top (screenMinY-34)
  // with 10px of breathing room.
  const barWidth = 320;
  let left = centerScreenX - barWidth / 2;
  left = Math.max(8, Math.min(window.innerWidth - barWidth - 8, left));
  let top = screenMinY - 90;
  top = Math.max(8, top);

  // Solve handler: ALWAYS uses OCR-based solve — captures the selected region
  // as an image, sends it to the VLM to read and solve, then inserts the answer.
  // Works for handwritten strokes AND typed text.
  const handleSolve = () => {
    solveSelection();
  };

  return (
    <div
      className="absolute z-40 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150"
      style={{ left, top }}
    >
      {/* Color swatch row (toggle) */}
      {showColors && (
        <div className="flex items-center gap-1.5 p-1.5 rounded-full bg-background/95 backdrop-blur shadow-lg border border-border/60 flex-wrap justify-center max-w-[340px]">
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
          {/* Custom color button — opens hue wheel picker */}
          <button
            className="h-6 w-6 rounded-full border-2 border-border hover:scale-110 transition-transform flex items-center justify-center"
            style={{
              background:
                "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            }}
            onClick={() => setShowCustomColor(true)}
            aria-label="Custom color"
          />
        </div>
      )}

      {/* Custom color picker dialog */}
      {showCustomColor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowCustomColor(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-2xl border border-border/60 p-5 max-w-xs mx-4 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Pick a color</h3>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowCustomColor(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <HueWheelColorPicker
              color={objects.find((o) => selection.ids.includes(o.id))?.color || "#000000"}
              onChange={(hex) => setSelectionColor(hex)}
            />
            <Button
              className="w-full mt-3 rounded-full"
              onClick={() => setShowCustomColor(false)}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Main action bar */}
      <div className="flex items-center gap-0.5 p-1 rounded-full bg-background/95 backdrop-blur shadow-xl border border-border/60">
        {/* Solve button — ALWAYS visible */}
        <Button
          variant="default"
          size="sm"
          className="h-9 gap-1.5 px-3 rounded-full"
          onClick={handleSolve}
          disabled={isSolving}
        >
          {isSolving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sigma className="h-4 w-4" />
          )}
          <span className="text-xs font-medium">
            {isSolving ? "Solving..." : "Solve"}
          </span>
        </Button>

        <div className="h-5 w-px bg-border mx-0.5" />

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9 rounded-full", showColors && "bg-accent")}
          onClick={() => setShowColors((v) => !v)}
        >
          <Palette className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={duplicateSelection}
        >
          <CopyPlus className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={copySelection}
        >
          <Copy className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border mx-0.5" />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-destructive hover:bg-destructive/10"
          onClick={deleteSelection}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
