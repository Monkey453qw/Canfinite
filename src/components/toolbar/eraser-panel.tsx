"use client";

/**
 * EraserPanel — single panel for the unified eraser tool.
 * Lets the user pick pixel vs stroke mode, adjust size, choose presets,
 * and tune stroke-eraser sensitivity.
 */

import React from "react";
import { X } from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SIZE_PRESETS = [8, 16, 24, 40, 60];

export function EraserPanel({ onClose }: { onClose: () => void }) {
  const eraser = useCanvasStore((s) => s.eraser);
  const setEraser = useCanvasStore((s) => s.setEraser);

  return (
    <div className="bg-background/95 backdrop-blur rounded-2xl shadow-xl border border-border/60 p-4 w-72 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Eraser</h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Mode toggle */}
      <div className="mb-3">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Mode</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant={eraser.mode === "pixel" ? "default" : "outline"}
            size="sm"
            className="text-xs flex flex-col items-center gap-0.5 h-auto py-2"
            onClick={() => setEraser({ mode: "pixel" })}
          >
            <span className="font-medium">Pixel</span>
            <span className="text-[9px] opacity-70">erase parts of strokes</span>
          </Button>
          <Button
            variant={eraser.mode === "stroke" ? "default" : "outline"}
            size="sm"
            className="text-xs flex flex-col items-center gap-0.5 h-auto py-2"
            onClick={() => setEraser({ mode: "stroke" })}
          >
            <span className="font-medium">Stroke</span>
            <span className="text-[9px] opacity-70">delete whole strokes</span>
          </Button>
        </div>
      </div>

      {/* Size presets */}
      <div className="mb-3">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Quick Sizes</Label>
        <div className="flex items-center justify-around gap-1.5">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s}
              className={cn(
                "h-9 flex-1 rounded-md border-2 transition-all flex items-center justify-center hover:bg-accent",
                eraser.size === s
                  ? "border-primary bg-primary/10"
                  : "border-border",
              )}
              onClick={() => setEraser({ size: s })}
            >
              <span
                className="rounded-full bg-foreground/70"
                style={{ width: Math.min(s, 20), height: Math.min(s, 20) }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Size slider */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <Label className="text-xs text-muted-foreground">Size</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{eraser.size.toFixed(0)}px</span>
        </div>
        <Slider
          min={4}
          max={120}
          step={2}
          value={[eraser.size]}
          onValueChange={(v) => setEraser({ size: v[0] })}
        />
      </div>

      {/* Sensitivity (stroke eraser only) */}
      {eraser.mode === "stroke" && (
        <div>
          <div className="flex justify-between mb-1">
            <Label className="text-xs text-muted-foreground">Sensitivity</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.round(eraser.sensitivity * 100)}%
            </span>
          </div>
          <Slider
            min={0}
            max={2}
            step={0.1}
            value={[eraser.sensitivity]}
            onValueChange={(v) => setEraser({ sensitivity: v[0] })}
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Higher = larger erase radius around touched strokes.
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-2 text-center">
        Tap on strokes to erase. Drag to erase continuously.
      </p>
    </div>
  );
}
