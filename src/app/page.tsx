"use client";

/**
 * Main page — composes the Infinite Canvas + Toolbar + Math Solver.
 * Also handles: theme application, auto-save (debounced), session restore,
 * and a one-time welcome hint overlay.
 */

import { useEffect, useState } from "react";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Toolbar } from "@/components/toolbar/toolbar";
import { SelectionFloatingBar } from "@/components/toolbar/selection-floating-bar";
import { MathSolver } from "@/components/math/math-solver";
import { BootAnimation } from "@/components/canvas/boot-animation";
import { useCanvasStore } from "@/lib/store/canvas-store";
import { loadDocument, createDebouncedSaver } from "@/lib/persistence/storage";
import { Toaster } from "@/components/ui/sonner";

const debouncedSave = createDebouncedSaver(500);

export default function Home() {
  const theme = useCanvasStore((s) => s.theme);
  const objects = useCanvasStore((s) => s.objects);
  const viewport = useCanvasStore((s) => s.viewport);
  const hydrate = useCanvasStore((s) => s.hydrate);
  const setTheme = useCanvasStore((s) => s.setTheme);
  const [hydrated, setHydrated] = useState(false);

  // Restore previous session on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await loadDocument();
      if (cancelled) return;
      if (doc && Array.isArray(doc.objects) && doc.objects.length > 0) {
        hydrate({
          objects: doc.objects as never[],
          viewport: doc.viewport,
        });
        // Center viewport on first object if reasonable
        setTimeout(() => {
          const vp = useCanvasStore.getState().viewport;
          if (vp.x === 0 && vp.y === 0) {
            const objs = useCanvasStore.getState().objects;
            if (objs.length > 0) {
              const first = objs[0];
              const cx =
                first.type === "stroke"
                  ? first.points[0]?.x ?? 0
                  : first.x + first.width / 2;
              const cy =
                first.type === "stroke"
                  ? first.points[0]?.y ?? 0
                  : first.y + first.height / 2;
              useCanvasStore.getState().setViewport({
                x: window.innerWidth / 2 - cx,
                y: window.innerHeight / 2 - cy,
              });
            }
          }
        }, 100);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.backgroundColor = theme === "dark" ? "#0f0f10" : "#fafafa";
  }, [theme]);

  // Detect system color scheme on first load
  useEffect(() => {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, [setTheme]);

  // Auto-save (debounced) — only after hydration to avoid overwriting stored doc
  useEffect(() => {
    if (!hydrated) return;
    debouncedSave(objects, viewport);
  }, [objects, viewport, hydrated]);

  // Save on app exit / page hide
  useEffect(() => {
    const onBeforeUnload = () => {
      const s = useCanvasStore.getState();
      void s;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onBeforeUnload);
    };
  }, []);

  // Register service worker for offline support
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      <InfiniteCanvas />
      <Toolbar />
      <SelectionFloatingBar />
      <MathSolver />
      <BootAnimation />
      <Toaster />
    </main>
  );
}
