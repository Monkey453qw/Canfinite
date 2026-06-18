"use client";

/**
 * Toolbar — floating Material 3-style toolbar with tool selection,
 * contextual settings panels, and global actions (undo/redo, screenshot,
 * reading mode, theme, math solver).
 *
 * NOTE: No tooltips — buttons never show a label popup on tap/hover.
 */

import React, { useState } from "react";
import {
  Pen,
  Eraser,
  MousePointer2,
  Type,
  Sigma,
  Camera,
  Undo2,
  Redo2,
  BookOpen,
  Sun,
  Moon,
  Trash2,
} from "lucide-react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PenPanel } from "./pen-panel";
import { EraserPanel } from "./eraser-panel";
import { SelectionActions } from "./selection-actions";
import { TextPanel } from "./text-panel";
import { ZoomIndicator } from "./zoom-indicator";

export function Toolbar() {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const past = useCanvasStore((s) => s.past);
  const future = useCanvasStore((s) => s.future);
  const theme = useCanvasStore((s) => s.theme);
  const setTheme = useCanvasStore((s) => s.setTheme);
  const readingMode = useCanvasStore((s) => s.readingMode);
  const setReadingMode = useCanvasStore((s) => s.setReadingMode);
  const toggleMathSolver = useCanvasStore((s) => s.toggleMathSolver);
  const selection = useCanvasStore((s) => s.selection);
  const clearAll = useCanvasStore((s) => s.clearAll);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const onToolClick = (t: typeof tool) => {
    // For pen/eraser/text: first tap selects the tool (no panel).
    // Second tap on the SAME tool opens the panel.
    // Third tap closes the panel.
    if (t === "pen" || t === "eraser" || t === "text") {
      if (tool === t) {
        // Tool already active — toggle the panel
        setOpenPanel((cur) => (cur === t ? null : t));
      } else {
        // Switching to a new tool — select it, don't open panel
        setTool(t);
        setOpenPanel(null);
      }
    } else {
      // Select tool — no panel, but close any open panel
      setOpenPanel(null);
      setTool(t);
    }
  };

  const tools = [
    { id: "pen", icon: Pen },
    { id: "eraser", icon: Eraser },
    { id: "select", icon: MousePointer2 },
    // Clear canvas button goes between select and text
    { id: "clear", icon: Trash2 },
    { id: "text", icon: Type },
  ] as const;

  return (
    <>
      {/* Top-left: reading mode + theme */}
      <div className="absolute top-4 left-4 z-30 flex gap-2">
        <Button
          variant={readingMode ? "default" : "outline"}
          size="icon"
          className="h-10 w-10 rounded-full bg-background/80 backdrop-blur shadow-md"
          onClick={() => setReadingMode(!readingMode)}
        >
          <BookOpen className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full bg-background/80 backdrop-blur shadow-md"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
      </div>

      {/* Top-right: math solver + screenshot */}
      <div className="absolute top-4 right-4 z-30 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-10 gap-2 rounded-full bg-background/80 backdrop-blur shadow-md px-4"
          onClick={toggleMathSolver}
        >
          <Sigma className="h-4 w-4" />
          <span className="text-sm font-medium">Math Solver</span>
        </Button>
        <ScreenshotButton />
      </div>

      {/* Invisible backdrop: tapping outside the panel closes it.
          Rendered before the toolbar so it sits underneath, but with a high
          z-index so it covers the canvas. The panel and toolbar are at z-30
          (above this backdrop at z-20). */}
      {openPanel && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setOpenPanel(null)}
          onPointerDown={() => setOpenPanel(null)}
        />
      )}

      {/* Bottom-center: main toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-3">
        {/* Contextual panel */}
        {openPanel === "pen" && <PenPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === "eraser" && <EraserPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === "text" && <TextPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === "select" && selection.ids.length > 0 && (
          <SelectionActions onClose={() => setOpenPanel(null)} />
        )}

        {/* Main tool buttons */}
        <div className="flex items-center gap-1.5 p-2 rounded-2xl bg-background/90 backdrop-blur shadow-xl border border-border/60">
          {tools.map((t) => {
            const Icon = t.icon;
            const isActive = tool === t.id;

            // Clear canvas button — special handling: clears immediately, no warning
            if (t.id === "clear") {
              return (
                <React.Fragment key={t.id}>
                  {/* Divider before clear */}
                  <div className="h-7 w-px bg-border mx-0.5" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 rounded-xl hover:bg-destructive/10 text-destructive transition-all"
                    onClick={() => clearAll()}
                  >
                    <Icon className="h-5 w-5" />
                  </Button>
                  {/* Divider after clear */}
                  <div className="h-7 w-px bg-border mx-0.5" />
                </React.Fragment>
              );
            }

            return (
              <Button
                key={t.id}
                variant="ghost"
                size="icon"
                className={cn(
                  "h-11 w-11 rounded-xl transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "hover:bg-accent",
                )}
                onClick={() => onToolClick(t.id)}
              >
                <Icon className="h-5 w-5" />
              </Button>
            );
          })}

          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-xl hover:bg-accent"
            onClick={undo}
            disabled={past.length === 0}
          >
            <Undo2 className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-xl hover:bg-accent"
            onClick={redo}
            disabled={future.length === 0}
          >
            <Redo2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Bottom-right: zoom indicator with lock */}
      <ZoomIndicator />
    </>
  );
}

// ----------------- Screenshot Button -----------------
function ScreenshotButton() {
  const takeScreenshot = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `canvas-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      import("sonner").then(({ toast }) => toast.success("Screenshot saved to your downloads"));
    } catch (e) {
      console.error(e);
      import("sonner").then(({ toast }) => toast.error("Screenshot failed"));
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-10 w-10 rounded-full bg-background/80 backdrop-blur shadow-md"
      onClick={takeScreenshot}
    >
      <Camera className="h-4 w-4" />
    </Button>
  );
}
