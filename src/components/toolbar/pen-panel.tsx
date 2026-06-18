"use client";

/**
 * PenPanel — color presets, custom hue wheel picker, size, opacity, live preview.
 */

import React, { useState } from "react";
import { X, Palette } from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { HueWheelColorPicker } from "./hue-wheel-picker";

const PRESET_COLORS = [
  "#111111", "#525252", "#9ca3af",
  "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#ec4899", "#a16207",
];

export function PenPanel({ onClose }: { onClose: () => void }) {
  const pen = useCanvasStore((s) => s.pen);
  const setPen = useCanvasStore((s) => s.setPen);
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  return (
    <div className="bg-background/95 backdrop-blur rounded-2xl shadow-xl border border-border/60 p-4 w-72 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Pen</h3>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Preview */}
      <div className="flex items-center justify-center h-12 mb-3 rounded-lg bg-muted/50 overflow-hidden">
        <svg width="100%" height="100%" viewBox="0 0 240 48" preserveAspectRatio="none">
          <path
            d="M 12 24 Q 60 8, 120 24 T 228 24"
            stroke={pen.color}
            strokeWidth={pen.size}
            strokeLinecap="round"
            fill="none"
            opacity={pen.opacity}
          />
        </svg>
      </div>

      {/* Preset colors */}
      <div className="mb-3">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Color</Label>
        <div className="grid grid-cols-6 gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={cn(
                "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                pen.color.toLowerCase() === c.toLowerCase()
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border",
              )}
              style={{ background: c }}
              onClick={() => {
                setPen({ color: c });
                setShowCustomPicker(false);
              }}
            />
          ))}
        </div>

        {/* Custom color toggle */}
        <button
          className={cn(
            "mt-2 w-full h-8 rounded-lg border-2 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors",
            showCustomPicker
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-accent",
          )}
          onClick={() => setShowCustomPicker((v) => !v)}
        >
          <Palette className="h-3.5 w-3.5" />
          {showCustomPicker ? "Hide custom picker" : "Custom color"}
        </button>

        {/* Hue wheel picker */}
        {showCustomPicker && (
          <div className="mt-3 pt-3 border-t border-border/60">
            <HueWheelColorPicker color={pen.color} onChange={(hex) => setPen({ color: hex })} />
          </div>
        )}
      </div>

      {/* Size */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <Label className="text-xs text-muted-foreground">Size</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{pen.size.toFixed(1)}px</span>
        </div>
        <Slider
          min={0.5}
          max={30}
          step={0.5}
          value={[pen.size]}
          onValueChange={(v) => setPen({ size: v[0] })}
        />
      </div>

      {/* Opacity */}
      <div>
        <div className="flex justify-between mb-1">
          <Label className="text-xs text-muted-foreground">Opacity</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.round(pen.opacity * 100)}%
          </span>
        </div>
        <Slider
          min={0.1}
          max={1}
          step={0.05}
          value={[pen.opacity]}
          onValueChange={(v) => setPen({ opacity: v[0] })}
        />
      </div>
    </div>
  );
}
