"use client";

/**
 * TextPanel — font family, size, alignment, color for selected text.
 * When no text is selected, these become defaults for newly-created text.
 */

import React from "react";
import { X } from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FONT_OPTIONS = [
  { label: "Sans", value: "Inter, system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, 'Courier New', monospace" },
  { label: "Round", value: "'Comic Sans MS', 'Comic Sans', cursive" },
];

const ALIGN_OPTIONS = [
  { label: "Left", value: "left" as const },
  { label: "Center", value: "center" as const },
  { label: "Right", value: "right" as const },
];

const TEXT_COLORS = ["#111111", "#525252", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

export function TextPanel({ onClose }: { onClose: () => void }) {
  const selection = useCanvasStore((s) => s.selection);
  const objects = useCanvasStore((s) => s.objects);
  const updateText = useCanvasStore((s) => s.updateText);
  const pen = useCanvasStore((s) => s.pen);

  // Find the selected text object (if any)
  const selectedText = objects.find(
    (o): o is import("@/lib/canvas/types").TextObject =>
      o.type === "text" && selection.ids.includes(o.id),
  );

  const set = (patch: Partial<import("@/lib/canvas/types").TextObject>) => {
    if (selectedText) {
      updateText(selectedText.id, patch);
    }
  };

  // Use selected text's properties, or defaults from pen color
  const color = selectedText?.color ?? pen.color;
  const fontSize = selectedText?.fontSize ?? 24;
  const fontFamily = selectedText?.fontFamily ?? FONT_OPTIONS[0].value;
  const align = selectedText?.align ?? "left";

  return (
    <div className="bg-background/95 backdrop-blur rounded-2xl shadow-xl border border-border/60 p-4 w-72 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          {selectedText ? "Text Style" : "Default Text Style"}
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!selectedText && (
        <p className="text-xs text-muted-foreground mb-3">
          Tap on the canvas to create text. Select existing text to edit.
        </p>
      )}

      {/* Font family */}
      <div className="mb-3">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Font</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {FONT_OPTIONS.map((f) => (
            <Button
              key={f.value}
              variant={fontFamily === f.value ? "default" : "outline"}
              size="sm"
              className="text-xs"
              style={{ fontFamily: f.value }}
              onClick={() => set({ fontFamily: f.value })}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <Label className="text-xs text-muted-foreground">Font Size</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{fontSize.toFixed(0)}px</span>
        </div>
        <Slider
          min={8}
          max={96}
          step={1}
          value={[fontSize]}
          onValueChange={(v) => set({ fontSize: v[0] })}
          disabled={!selectedText}
        />
      </div>

      {/* Alignment */}
      <div className="mb-3">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Alignment</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {ALIGN_OPTIONS.map((a) => (
            <Button
              key={a.value}
              variant={align === a.value ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => set({ align: a.value })}
              disabled={!selectedText}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">Color</Label>
        <div className="grid grid-cols-8 gap-1.5">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                color.toLowerCase() === c.toLowerCase()
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border",
              )}
              style={{ background: c }}
              onClick={() => set({ color: c })}
              disabled={!selectedText}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="color"
            value={color}
            onChange={(e) => set({ color: e.target.value })}
            className="h-8 w-12 p-0 border-0 cursor-pointer"
            disabled={!selectedText}
          />
          <Input
            type="text"
            value={color}
            onChange={(e) => set({ color: e.target.value })}
            className="h-8 text-xs font-mono"
            disabled={!selectedText}
          />
        </div>
      </div>
    </div>
  );
}
