"use client";

/**
 * InfiniteCanvas — the heart of the application.
 *
 * Architecture:
 *   - Single <canvas> sized to the viewport, with devicePixelRatio scaling.
 *   - World <-> screen coordinate transforms via the store's viewport.
 *   - One render loop (rAF) that re-draws whenever state changes.
 *   - Pointer events handle 1-finger draw and 2-finger pan/zoom uniformly.
 *   - Active stroke is drawn incrementally for ultra-low latency.
 *
 * Rendering layers (back to front):
 *   1. Background (theme color)
 *   2. Infinite grid (dotted, adapts to zoom)
 *   3. Committed objects (strokes via cached Bezier segments, text, solver boxes)
 *   4. Active stroke (live drawing)
 *   5. Selection overlay (bounds, handles)
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { useCanvasStore } from "@/lib/store/canvas-store";
import {
  boundsOverlap,
  hitTestHandle,
  hitTestObject,
  midpoint,
  objectInPolygon,
  pointerDistance,
  screenToWorld,
  visibleWorldBounds,
  worldToScreen,
  type HandleId,
} from "@/lib/canvas/geometry";
import {
  incrementalBezier,
  buildSmoothedCache,
} from "@/lib/canvas/smoothing";
import type {
  CanvasObject,
  Point,
  Stroke,
  Viewport,
} from "@/lib/canvas/types";
import { TextEditorOverlay } from "./text-editor-overlay";

interface PointerInfo {
  id: number;
  x: number;
  y: number;
}

interface GestureState {
  pointers: Map<number, PointerInfo>;
  mode: "none" | "draw" | "pan" | "select";
  // For pan
  lastMidpoint: Point | null;
  lastDist: number | null;
  lastViewport: Viewport | null;
  // For selection drag
  dragMode: "none" | "move" | "resize" | "rotate";
  dragHandle: HandleId | null;
  dragStartWorld: Point | null;
  dragStartObjectSnapshot: CanvasObject[] | null;
  /** Tracks whether we've already pushed history for the current drag. */
  historyPushed: boolean;
  // For free-form lasso selection
  lassoPath: Point[] | null;
  // Live stroke cache (separate from store for performance)
  liveCache: { start: Point; cp1: Point; cp2: Point; end: Point }[] | null;
}

export function InfiniteCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs for fast access inside event handlers (avoid re-renders)
  const objectsRef = useRef<CanvasObject[]>([]);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const toolRef = useRef<string>("pen");
  const penRef = useRef({ color: "#111", size: 3, opacity: 1 });
  const eraserRef = useRef({ size: 24, sensitivity: 0.5, mode: "pixel" as "pixel" | "stroke" });
  const selectionRef = useRef<{ ids: string[] }>({ ids: [] });
  const readingModeRef = useRef(false);
  const themeRef = useRef<"light" | "dark">("light");
  const activeStrokeRef = useRef<Stroke | null>(null);
  const eraserCursorRef = useRef<Point | null>(null);
  // Double-tap detection for pen tool: if the user taps twice quickly on a
  // text object while using the pen, select that text instead of drawing.
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  // Deferred stroke start for touch: when a touch pointerdown happens with the
  // pen tool, we don't create the stroke immediately. Instead we store the
  // point here. On the first pointermove we create the stroke (confirming the
  // user is drawing). On pointerup, if no second finger arrived, we create a
  // dot. If a second finger arrives (two-finger gesture), we discard.
  const pendingDrawRef = useRef<{ point: Point; time: number } | null>(null);
  const gestureRef = useRef<GestureState>({
    pointers: new Map(),
    mode: "none",
    lastMidpoint: null,
    lastDist: null,
    lastViewport: null,
    dragMode: "none",
    dragHandle: null,
    dragStartWorld: null,
    dragStartObjectSnapshot: null,
    historyPushed: false,
    lassoPath: null,
    liveCache: null,
  });

  // Subscribe to store changes — keep refs in sync + trigger redraw
  const objects = useCanvasStore((s) => s.objects);
  const viewport = useCanvasStore((s) => s.viewport);
  const tool = useCanvasStore((s) => s.tool);
  const pen = useCanvasStore((s) => s.pen);
  const eraser = useCanvasStore((s) => s.eraser);
  const selection = useCanvasStore((s) => s.selection);
  const readingMode = useCanvasStore((s) => s.readingMode);
  const theme = useCanvasStore((s) => s.theme);
  const activeStroke = useCanvasStore((s) => s.activeStroke);
  const editingTextId = useCanvasStore((s) => s.editingTextId);

  // Keep refs in sync with state for use inside imperative event handlers.
  // Updated in an effect to satisfy React's "no ref writes during render" rule.
  useEffect(() => {
    objectsRef.current = objects;
    viewportRef.current = viewport;
    toolRef.current = tool;
    penRef.current = pen;
    eraserRef.current = eraser;
    selectionRef.current = selection;
    readingModeRef.current = readingMode;
    themeRef.current = theme;
    activeStrokeRef.current = activeStroke;
  }, [objects, viewport, tool, pen, eraser, selection, readingMode, theme, activeStroke]);

  // Actions
  const beginStroke = useCanvasStore((s) => s.beginStroke);
  const appendStrokePoint = useCanvasStore((s) => s.appendStrokePoint);
  const endStroke = useCanvasStore((s) => s.endStroke);
  const eraseAtPoint = useCanvasStore((s) => s.eraseAtPoint);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const setTool = useCanvasStore((s) => s.setTool);
  const select = useCanvasStore((s) => s.select);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const addToSelection = useCanvasStore((s) => s.addToSelection);
  const moveSelectionBy = useCanvasStore((s) => s.moveSelectionBy);
  const commitSelectionMove = useCanvasStore((s) => s.commitSelectionMove);
  const pushHistory = useCanvasStore((s) => s.pushHistory);
  const addText = useCanvasStore((s) => s.addText);

  // ----------------- Render loop -----------------
  // (declared before the sizing effect that depends on it)
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    const vp = viewportRef.current;
    const objs = objectsRef.current;
    const theme = themeRef.current;
    const active = activeStrokeRef.current;
    const sel = selectionRef.current;
    const gesture = gestureRef.current;

    // ----- Clear with theme background -----
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme === "dark" ? "#0f0f10" : "#fafafa";
    ctx.fillRect(0, 0, w, h);

    // ----- Apply world transform -----
    ctx.translate(vp.x, vp.y);
    ctx.scale(vp.scale, vp.scale);

    // (Dot grid removed — clean background only)

    // ----- Draw visible objects -----
    const viewBounds = visibleWorldBounds(w, h, vp);
    const editingId = useCanvasStore.getState().editingTextId;
    for (const o of objs) {
      // Skip text objects that are currently being edited — the textarea
      // overlay handles display during editing, so we don't double-render.
      if (o.id === editingId) continue;
      const ob = objectBoundsLocal(o);
      if (ob && !boundsOverlap(ob, viewBounds)) continue;
      drawObject(ctx, o, theme);
    }

    // ----- Draw active (in-progress) stroke -----
    if (active) {
      drawActiveStroke(ctx, active, gesture.liveCache);
    }

    // ----- Draw eraser cursor preview (shown when eraser tool is active and pointer is hovering) -----
    if (toolRef.current === "eraser" && eraserCursorRef.current) {
      const ec = eraserCursorRef.current;
      const r = eraserRef.current.size / 2;
      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
      ctx.fillStyle = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
      ctx.lineWidth = 1.5 / vp.scale;
      ctx.beginPath();
      ctx.arc(ec.x, ec.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // ----- Draw free-form lasso selection path -----
    if (gesture.lassoPath && gesture.lassoPath.length >= 2) {
      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "#a3a3ff" : "#5b5bf0";
      ctx.fillStyle =
        theme === "dark" ? "rgba(124,124,240,0.08)" : "rgba(91,91,240,0.06)";
      ctx.lineWidth = 2 / vp.scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([8 / vp.scale, 4 / vp.scale]);
      ctx.beginPath();
      ctx.moveTo(gesture.lassoPath[0].x, gesture.lassoPath[0].y);
      for (let i = 1; i < gesture.lassoPath.length; i++) {
        ctx.lineTo(gesture.lassoPath[i].x, gesture.lassoPath[i].y);
      }
      // Close the path (dashed line back to start)
      ctx.lineTo(gesture.lassoPath[0].x, gesture.lassoPath[0].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ----- Draw selection overlay -----
    if (sel.ids.length > 0 && toolRef.current === "select") {
      drawSelectionOverlay(ctx, objs, sel.ids, vp, theme);
    }

    ctx.restore();
  }, []);

  // Re-render on any state change
  useEffect(() => {
    requestAnimationFrame(render);
  }, [render, objects, viewport, tool, pen, eraser, selection, readingMode, theme, activeStroke, editingTextId]);

  // ----------------- Canvas sizing -----------------
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      requestAnimationFrame(render);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [render]);

  // Clear eraser cursor when the pointer leaves the canvas
  useEffect(() => {
    const onLeave = () => {
      eraserCursorRef.current = null;
      requestAnimationFrame(render);
    };
    const canvas = canvasRef.current;
    canvas?.addEventListener("pointerleave", onLeave);
    return () => canvas?.removeEventListener("pointerleave", onLeave);
  }, [render]);

  // ----------------- Native touch gesture handling -----------------
  // Two-finger pan + pinch-zoom is handled ENTIRELY via native touch events
  // (not pointer events) because pointer events for the second finger can be
  // unreliable on some touch devices/browsers.
  //
  // Pattern adapted from reference: capture INITIAL state at gesture start
  // (initialDist, initialZoom, initialCenter, initialPan), then on each move
  // compute the new viewport relative to that initial state. This is more
  // stable than incremental tracking (which accumulates rounding errors).
  //
  const touchGestureActiveRef = useRef(false);
  const touchStateRef = useRef<{
    touches: Map<number, { x: number; y: number }>;
    initialDist: number | null;
    initialScale: number;
    initialCenter: { x: number; y: number } | null;
    initialViewport: { x: number; y: number; scale: number };
    isGesture: boolean;
  }>({
    touches: new Map(),
    initialDist: null,
    initialScale: 1,
    initialCenter: null,
    initialViewport: { x: 0, y: 0, scale: 1 },
    isGesture: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get touch point in canvas-local coordinates
    const getTouchPoint = (touch: Touch): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    };

    const getTouchDist = (touches: Map<number, { x: number; y: number }>): number | null => {
      const pts = Array.from(touches.values());
      if (pts.length < 2) return null;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (touches: Map<number, { x: number; y: number }>): { x: number; y: number } | null => {
      const pts = Array.from(touches.values());
      if (pts.length < 2) return null;
      return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    };

    const onTouchStart = (e: TouchEvent) => {
      const ts = touchStateRef.current;
      // Track all active touches
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        ts.touches.set(t.identifier, getTouchPoint(t));
      }

      if (ts.touches.size >= 2) {
        // Start two-finger gesture — always works regardless of active tool
        e.preventDefault();
        touchGestureActiveRef.current = true;
        ts.isGesture = true;

        // Capture INITIAL state (not incremental) for stable zoom math
        ts.initialDist = getTouchDist(ts.touches);
        const vp = viewportRef.current;
        ts.initialScale = vp.scale;
        ts.initialCenter = getTouchCenter(ts.touches);
        ts.initialViewport = { ...vp };

        // Cancel any in-progress drawing or lasso.
        // IMPORTANT: discard the active stroke WITHOUT committing it —
        // calling endStroke() would save a 1-point dot to the canvas.
        const g = gestureRef.current;
        if (g.mode === "draw") {
          // Discard the in-progress stroke directly (no history push)
          useCanvasStore.setState({ activeStroke: null, isDrawing: false });
          g.mode = "none";
        }
        // Also discard any pending touch draw (first finger touched but
        // no stroke was created yet — now second finger arrived = gesture)
        if (pendingDrawRef.current) {
          pendingDrawRef.current = null;
        }
        if (g.lassoPath) {
          g.lassoPath = null;
          clearSelection();
        }
        g.dragStartWorld = null;
        g.dragStartObjectSnapshot = null;
        g.dragMode = "none";
        g.mode = "pan";

        requestAnimationFrame(render);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchStateRef.current;
      // Update tracked touches
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        ts.touches.set(t.identifier, getTouchPoint(t));
      }

      if (ts.isGesture && ts.touches.size >= 2 && ts.initialDist && ts.initialCenter) {
        e.preventDefault();

        const currentDist = getTouchDist(ts.touches);
        const currentCenter = getTouchCenter(ts.touches);

        if (currentDist && currentCenter) {
          // Zoom: scale relative to INITIAL distance (not last frame)
          // Skip zoom if zoom is locked — only pan
          const zoomLocked = useCanvasStore.getState().zoomLocked;
          const scale = zoomLocked ? 1 : currentDist / ts.initialDist;
          const newScale = Math.max(0.05, Math.min(10, ts.initialScale * scale));

          // Pan: keep the initial center point stable (anchor-point preservation)
          const iv = ts.initialViewport;
          const ic = ts.initialCenter;
          const worldX = (ic.x - iv.x) / iv.scale;
          const worldY = (ic.y - iv.y) / iv.scale;
          const dx = currentCenter.x - ic.x;
          const dy = currentCenter.y - ic.y;
          setViewport({
            scale: newScale,
            x: ic.x - worldX * newScale + dx,
            y: ic.y - worldY * newScale + dy,
          });
        }
        requestAnimationFrame(render);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const ts = touchStateRef.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        ts.touches.delete(e.changedTouches[i].identifier);
      }
      if (ts.touches.size < 2 && ts.isGesture) {
        e.preventDefault();
        ts.isGesture = false;
        ts.initialDist = null;
        ts.initialCenter = null;
        touchGestureActiveRef.current = false;

        // Reset gesture state
        const g = gestureRef.current;
        g.mode = "none";
        g.lastMidpoint = null;
        g.lastDist = null;
        g.lastViewport = null;
        g.pointers.clear();
        g.dragStartWorld = null;
        g.dragStartObjectSnapshot = null;
        g.dragMode = "none";
        g.historyPushed = false;
        (g as GestureState & { lastMove?: Point }).lastMove = undefined;
        requestAnimationFrame(render);
      }
    };

    // passive: false is REQUIRED to call preventDefault()
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [render, setViewport, endStroke, clearSelection]);

  // ----------------- Non-passive wheel zoom (mouse / trackpad) -----------------
  // Zoom anchored at the mouse position so the world point under the cursor
  // stays fixed. Pattern adapted from reference.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const vp = viewportRef.current;
      // Skip zoom if locked — just pan
      const zoomLocked = useCanvasStore.getState().zoomLocked;
      if (zoomLocked) {
        setViewport({ x: vp.x - e.deltaX, y: vp.y - e.deltaY });
        requestAnimationFrame(render);
        return;
      }
      const worldX = (mouseX - vp.x) / vp.scale;
      const worldY = (mouseY - vp.y) / vp.scale;
      const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
      const newScale = Math.max(0.05, Math.min(10, vp.scale * zoomFactor));
      setViewport({
        scale: newScale,
        x: mouseX - worldX * newScale,
        y: mouseY - worldY * newScale,
      });
      requestAnimationFrame(render);
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [render, setViewport]);

  // ----------------- Pointer handlers -----------------
  const getCanvasPoint = useCallback((e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Skip if a native two-finger touch gesture is active
      if (touchGestureActiveRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Prevent browser default touch behavior (scroll, pinch-zoom, etc.)
      e.preventDefault();
      // Only capture pointer for mouse — for touch, capturing can interfere
      // with multi-touch gesture tracking on some browsers.
      if (e.pointerType === "mouse") {
        canvas.setPointerCapture(e.pointerId);
      }
      const pt = getCanvasPoint(e);
      const g = gestureRef.current;
      g.pointers.set(e.pointerId, { id: e.pointerId, x: pt.x, y: pt.y });

      const vp = viewportRef.current;
      const world = screenToWorld(pt, vp);

      // ---- Multi-touch: pan/zoom ----
      if (g.pointers.size >= 2) {
        // Cancel any in-progress stroke
        if (g.mode === "draw") {
          endStroke();
        }
        if (g.mode === "select" && g.lassoPath) {
          g.lassoPath = null;
          clearSelection();
        }
        const pts = Array.from(g.pointers.values());
        g.mode = "pan";
        g.lastMidpoint = midpoint(pts[0], pts[1]);
        g.lastDist = pointerDistance(pts[0], pts[1]);
        g.lastViewport = { ...vp };
        requestAnimationFrame(render);
        return;
      }

      // ---- Single pointer ----
      const tool = toolRef.current;
      const readingMode = readingModeRef.current;

      if (readingMode) {
        // Pan only
        g.mode = "pan";
        g.lastMidpoint = pt;
        g.lastViewport = { ...vp };
        return;
      }

      if (tool === "pen") {
        // Double-tap detection: if the user taps twice within 300ms on the same
        // spot while using the pen, and that spot is on a text object, select
        // the text instead of drawing.
        const now = Date.now();
        const lastTap = lastTapRef.current;
        const DOUBLE_TAP_MS = 300;
        const DOUBLE_TAP_DIST = 20; // px tolerance

        if (
          lastTap &&
          now - lastTap.time < DOUBLE_TAP_MS &&
          Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < DOUBLE_TAP_DIST
        ) {
          // Check if the tap is on a text/solver object
          const hitId = hitTestObject(objectsRef.current, world, 14 / vp.scale);
          if (hitId) {
            const hitObj = objectsRef.current.find((o) => o.id === hitId);
            if (hitObj && (hitObj.type === "text" || hitObj.type === "solver")) {
              // Double-tap on text/solver → select it and switch to select tool
              setTool("select");
              select([hitId]);
              lastTapRef.current = null;
              requestAnimationFrame(render);
              return;
            }
          }
        }

        // Record this tap for double-tap detection
        lastTapRef.current = { time: now, x: pt.x, y: pt.y };

        // For touch pointers: defer stroke creation to avoid creating a dot
        // when the user is actually starting a two-finger pan/zoom gesture.
        // The stroke is created on the first pointermove (confirming drawing)
        // or on pointerup if no second finger arrived (creating a dot).
        // For mouse: create immediately (no two-finger gesture possible).
        if (e.pointerType === "touch") {
          pendingDrawRef.current = { point: world, time: now };
          // Don't set g.mode = "draw" yet — wait for move or up
          return;
        }

        g.mode = "draw";
        g.liveCache = [];
        beginStroke(world);
        requestAnimationFrame(render);
        return;
      }

      if (tool === "eraser") {
        g.mode = "pan"; // reuse "pan" mode flag for eraser drag tracking
        // eraseAtPoint checks eraser.mode internally to pick pixel vs stroke behavior
        eraseAtPoint(world, 4);
        requestAnimationFrame(render);
        return;
      }

      if (tool === "text") {
        addText(world);
        // Don't call setTool here — addText already switches to "select"
        // and preserves editingTextId (which setTool would clear).
        requestAnimationFrame(render);
        return;
      }

      if (tool === "select") {
        // Check selection handles first
        if (selectionRef.current.ids.length > 0) {
          const selObjs = objectsRef.current.filter((o) =>
            selectionRef.current.ids.includes(o.id),
          );
          // Compute selection bounds in world
          const bounds = computeSelectionBounds(selObjs);
          if (bounds) {
            const handleSize = 12 / vp.scale;
            const handle = hitTestHandle(bounds, world, handleSize);
            if (handle && handle !== "body") {
              g.mode = "select";
              g.dragMode = handle === "rotate" ? "rotate" : "resize";
              g.dragHandle = handle;
              g.dragStartWorld = world;
              g.dragStartObjectSnapshot = selObjs.map((o) => ({ ...o }));
              // History is pushed on first actual drag move (see onPointerMove)
              g.historyPushed = false;
              return;
            }
            if (handle === "body") {
              g.mode = "select";
              g.dragMode = "move";
              g.dragStartWorld = world;
              g.dragStartObjectSnapshot = selObjs.map((o) => ({ ...o }));
              g.historyPushed = false;
              return;
            }
          }
        }
        // Otherwise hit-test topmost object
        // 14 world units of tolerance — generous for finger taps on touch devices,
        // still feels precise on mouse.
        const hitId = hitTestObject(objectsRef.current, world, 14 / vp.scale);
        if (hitId) {
          if (e.shiftKey) {
            addToSelection(hitId);
          } else if (!selectionRef.current.ids.includes(hitId)) {
            select([hitId]);
          }
          g.mode = "select";
          g.dragMode = "move";
          g.dragStartWorld = world;
          g.historyPushed = false;
          // Snapshot the selected object(s) synchronously so pointermove can use it immediately.
          // We include the just-clicked object so the snapshot is correct even before
          // the `select()` store update propagates to our ref.
          const selIds = e.shiftKey
            ? Array.from(new Set([...selectionRef.current.ids, hitId]))
            : [hitId];
          g.dragStartObjectSnapshot = objectsRef.current
            .filter((o) => selIds.includes(o.id))
            .map((o) => ({ ...o }));
        } else {
          // Start free-form lasso selection
          if (!e.shiftKey) clearSelection();
          g.mode = "select";
          g.dragMode = "none";
          g.lassoPath = [world];
        }
        requestAnimationFrame(render);
        return;
      }
    },
    [
      beginStroke,
      endStroke,
      eraseAtPoint,
      addText,
      setTool,
      select,
      addToSelection,
      clearSelection,
      render,
      getCanvasPoint,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Skip if a native two-finger touch gesture is active
      if (touchGestureActiveRef.current) return;
      const g = gestureRef.current;
      // Allow processing if there's a pending draw (touch), even if mode is "none"
      if (g.pointers.size === 0 && g.mode === "none" && !pendingDrawRef.current) return;
      // Prevent browser default (scroll, etc.) during active gestures
      if (g.mode !== "none") e.preventDefault();
      const pt = getCanvasPoint(e);
      const vp = viewportRef.current;

      // Update tracked pointer
      if (g.pointers.has(e.pointerId)) {
        g.pointers.set(e.pointerId, { id: e.pointerId, x: pt.x, y: pt.y });
      }

      // ---- Two-finger pan + pinch zoom ----
      if (g.pointers.size >= 2 && g.mode === "pan") {
        const pts = Array.from(g.pointers.values());
        const mid = midpoint(pts[0], pts[1]);
        const dist = pointerDistance(pts[0], pts[1]);
        if (g.lastMidpoint && g.lastDist && g.lastViewport) {
          const dx = mid.x - g.lastMidpoint.x;
          const dy = mid.y - g.lastMidpoint.y;
          const scaleFactor = dist / g.lastDist;
          const newScale = clamp(
            g.lastViewport.scale * scaleFactor,
            0.05,
            40,
          );
          // Zoom around the midpoint: keep the world point under the midpoint fixed
          const worldAnchor = screenToWorld(mid, g.lastViewport);
          const newVp: Viewport = {
            scale: newScale,
            x: mid.x - worldAnchor.x * newScale,
            y: mid.y - worldAnchor.y * newScale,
          };
          setViewport(newVp);
        }
        g.lastMidpoint = mid;
        g.lastDist = dist;
        requestAnimationFrame(render);
        return;
      }

      // ---- Reading mode: one-finger pan ----
      if (readingModeRef.current && g.mode === "pan" && g.lastMidpoint && g.lastViewport) {
        const dx = pt.x - g.lastMidpoint.x;
        const dy = pt.y - g.lastMidpoint.y;
        setViewport({
          x: g.lastViewport.x + dx,
          y: g.lastViewport.y + dy,
        });
        g.lastMidpoint = pt;
        requestAnimationFrame(render);
        return;
      }

      // ---- Eraser drag ----
      if (toolRef.current === "eraser" && g.mode === "pan") {
        const world = screenToWorld(pt, vp);
        // Update eraser cursor position for visual feedback
        eraserCursorRef.current = world;
        eraseAtPoint(world, 4);
        requestAnimationFrame(render);
        return;
      }

      // ---- Eraser hover (no button pressed) — just update cursor preview ----
      if (toolRef.current === "eraser" && g.mode === "none" && g.pointers.size === 0) {
        eraserCursorRef.current = screenToWorld(pt, vp);
        requestAnimationFrame(render);
        return;
      }

      // ---- Pending draw (touch): convert to actual stroke on first move ----
      if (pendingDrawRef.current && toolRef.current === "pen") {
        const world = screenToWorld(pt, vp);
        const startPoint = pendingDrawRef.current.point;
        // Only start drawing if the finger has moved enough to confirm intent
        const moveDist = Math.hypot(world.x - startPoint.x, world.y - startPoint.y);
        if (moveDist > 1) {
          // User is drawing — create the stroke with the original + current point
          g.mode = "draw";
          g.liveCache = [];
          beginStroke(startPoint);
          appendStrokePoint(world);
          pendingDrawRef.current = null;
          requestAnimationFrame(render);
        }
        return;
      }

      // ---- Drawing ----
      if (g.mode === "draw" && activeStrokeRef.current) {
        const world = screenToWorld(pt, vp);
        appendStrokePoint(world);
        // Update live cache incrementally for smooth realtime rendering
        const pts = activeStrokeRef.current.points;
        if (pts.length >= 2) {
          const seg = incrementalBezier(pts.slice(-2, -1).concat(pts.slice(-1)), world);
          if (seg && g.liveCache) g.liveCache.push(seg);
        }
        requestAnimationFrame(render);
        return;
      }

      // ---- Selection drag ----
      const world = screenToWorld(pt, vp); // shared by selection drag AND rubber band
      if (g.mode === "select" && g.dragStartWorld) {
        if (g.dragMode === "move") {
          const dx = world.x - g.dragStartWorld.x;
          const dy = world.y - g.dragStartWorld.y;
          // Only push history on first actual move (avoid polluting history on click)
          if (!g.historyPushed && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
            pushHistory();
            g.historyPushed = true;
          }
          // Apply delta from snapshot (absolute, not incremental — avoids drift)
          if (g.dragStartObjectSnapshot) {
            // Reset to snapshot then apply delta
            const store = useCanvasStore.getState();
            // Use moveSelectionBy with delta from last move position
            // Easier: track lastMove and apply delta
            const lastMove = (g as GestureState & { lastMove?: Point }).lastMove ?? g.dragStartWorld;
            const incDx = world.x - lastMove.x;
            const incDy = world.y - lastMove.y;
            moveSelectionBy(incDx, incDy);
            (g as GestureState & { lastMove?: Point }).lastMove = world;
            requestAnimationFrame(render);
          }
          return;
        }

        if (g.dragMode === "resize" && g.dragStartObjectSnapshot) {
          // Simple uniform scale based on distance from center
          const snap = g.dragStartObjectSnapshot;
          const bounds = computeSelectionBounds(snap);
          if (bounds) {
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            const startDist = Math.hypot(g.dragStartWorld.x - cx, g.dragStartWorld.y - cy);
            const curDist = Math.hypot(world.x - cx, world.y - cy);
            if (startDist > 0.001) {
              const factor = curDist / startDist;
              if (!g.historyPushed && Math.abs(factor - 1) > 0.005) {
                pushHistory();
                g.historyPushed = true;
              }
              applyScaleToSelection(snap, factor, cx, cy);
              requestAnimationFrame(render);
            }
          }
          return;
        }

        if (g.dragMode === "rotate" && g.dragStartObjectSnapshot) {
          const snap = g.dragStartObjectSnapshot;
          const bounds = computeSelectionBounds(snap);
          if (bounds) {
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            const startAng = Math.atan2(g.dragStartWorld.y - cy, g.dragStartWorld.x - cx);
            const curAng = Math.atan2(world.y - cy, world.x - cx);
            const delta = curAng - startAng;
            if (!g.historyPushed && Math.abs(delta) > 0.01) {
              pushHistory();
              g.historyPushed = true;
            }
            applyRotationToSelection(snap, delta, cx, cy);
            requestAnimationFrame(render);
          }
          return;
        }
      }

      // ---- Free-form lasso selection ----
      if (g.mode === "select" && g.lassoPath) {
        // Append the current point to the lasso path
        g.lassoPath.push(world);
        // Test which objects are inside the lasso polygon
        const hits: string[] = [];
        if (g.lassoPath.length >= 3) {
          for (const o of objectsRef.current) {
            if (objectInPolygon(o, g.lassoPath)) hits.push(o.id);
          }
        }
        select(hits);
        requestAnimationFrame(render);
        return;
      }
    },
    [
      setViewport,
      appendStrokePoint,
      beginStroke,
      endStroke,
      eraseAtPoint,
      moveSelectionBy,
      select,
      pushHistory,
      render,
      getCanvasPoint,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Skip if a native two-finger touch gesture is active
      if (touchGestureActiveRef.current) return;
      const g = gestureRef.current;
      g.pointers.delete(e.pointerId);

      // If still pointers remaining, continue pan/zoom
      if (g.pointers.size >= 2) {
        const pts = Array.from(g.pointers.values());
        g.lastMidpoint = midpoint(pts[0], pts[1]);
        g.lastDist = pointerDistance(pts[0], pts[1]);
        g.lastViewport = { ...viewportRef.current };
        return;
      }
      if (g.pointers.size === 1) {
        // Drop from 2 to 1 finger — reanchor pan
        const remaining = Array.from(g.pointers.values())[0];
        g.lastMidpoint = { x: remaining.x, y: remaining.y };
        g.lastViewport = { ...viewportRef.current };
        return;
      }

      // All pointers up — finalize gesture

      // Handle pending draw (touch tap that didn't become a two-finger gesture):
      // create a single-point dot stroke.
      if (pendingDrawRef.current) {
        const point = pendingDrawRef.current.point;
        pendingDrawRef.current = null;
        // Create the dot stroke
        g.mode = "draw";
        beginStroke(point);
        endStroke();
        g.mode = "none";
        return;
      }

      if (g.mode === "draw") {
        endStroke();
      }
      if (g.mode === "select" && g.dragMode !== "none" && g.historyPushed) {
        commitSelectionMove();
      }
      if (g.lassoPath) {
        g.lassoPath = null;
      }
      g.mode = "none";
      g.dragMode = "none";
      g.dragHandle = null;
      g.dragStartWorld = null;
      g.dragStartObjectSnapshot = null;
      g.historyPushed = false;
      (g as GestureState & { lastMove?: Point }).lastMove = undefined;
      g.liveCache = null;
      requestAnimationFrame(render);
    },
    [beginStroke, endStroke, commitSelectionMove, render],
  );

  // (Wheel zoom is handled by the native non-passive listener above,
  //  which can call preventDefault() — React's synthetic onWheel cannot.)

  // ----------------- Keyboard shortcuts -----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const store = useCanvasStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        store.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        store.copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        store.paste();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        store.duplicateSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (store.selection.ids.length > 0) {
          e.preventDefault();
          store.deleteSelection();
        }
      } else if (e.key === "Escape") {
        store.clearSelection();
        store.finishEditingText();
      } else if (e.key === "1") {
        store.setTool("pen");
      } else if (e.key === "2") {
        store.setTool("eraser");
      } else if (e.key === "3") {
        store.setTool("select");
      } else if (e.key === "4") {
        store.setTool("text");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden touch-none select-none"
      style={{ touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{
          touchAction: "none", // CRITICAL: prevents browser from intercepting pinch-zoom / pan
          cursor:
            readingMode || tool === "reading"
              ? "grab"
              : tool === "select"
              ? "default"
              : tool === "text"
              ? "text"
              : tool === "eraser"
              ? "none" // hide native cursor — we draw a custom eraser preview
              : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <TextEditorOverlay />
    </div>
  );
}

// ----------------- Drawing helpers -----------------

function objectBoundsLocal(o: CanvasObject) {
  if (o.type === "stroke") return o.bounds ?? null;
  const pad = 4;
  return {
    minX: o.x - pad,
    minY: o.y - pad,
    maxX: o.x + o.width + pad,
    maxY: o.y + o.height + pad,
  };
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  o: CanvasObject,
  _theme: "light" | "dark",
) {
  if (o.type === "stroke") {
    drawStroke(ctx, o);
  } else if (o.type === "text") {
    drawText(ctx, o);
  } else if (o.type === "solver") {
    drawSolverBox(ctx, o);
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  // Single-point stroke (a tap/dot) — render as a filled circle
  if (s.points.length === 1) {
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (s.cached && s.cached.length > 0) {
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const first = s.cached[0].start;
    ctx.moveTo(first.x, first.y);
    for (const seg of s.cached) {
      ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Fallback: raw polyline (single-point case already handled above)
  if (s.points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  for (let i = 1; i < s.points.length; i++) {
    ctx.lineTo(s.points[i].x, s.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawActiveStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  liveCache: { start: Point; cp1: Point; cp2: Point; end: Point }[] | null,
) {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (s.points.length === 0) {
    ctx.restore();
    return;
  }
  // Single-point active stroke (a tap/dot being drawn) — render as a filled circle
  if (s.points.length === 1 && (!liveCache || liveCache.length === 0)) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.moveTo(s.points[0].x, s.points[0].y);
  if (liveCache && liveCache.length > 0) {
    for (const seg of liveCache) {
      ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
    }
  } else {
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, t: import("@/lib/canvas/types").TextObject) {
  ctx.save();
  // Position text from top-left corner (matches the textarea overlay positioning)
  ctx.translate(t.x, t.y);
  ctx.rotate(t.rotation);
  ctx.fillStyle = t.color;
  ctx.font = `${t.fontSize}px ${t.fontFamily}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const lines = t.text.split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, i * t.fontSize * 1.2);
  });
  ctx.restore();
}

function drawSolverBox(ctx: CanvasRenderingContext2D, s: import("@/lib/canvas/types").SolverBox) {
  ctx.save();
  ctx.translate(s.x + s.width / 2, s.y + s.height / 2);
  ctx.rotate(s.rotation);
  ctx.translate(-s.width / 2, -s.height / 2);
  // Card background
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 2;
  roundRect(ctx, 0, 0, s.width, s.height, 12);
  ctx.fill();
  ctx.stroke();
  // Question — starts at 14px from top (matches height computation)
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "600 14px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const qLines = wrapText(ctx, s.question, s.width - 24);
  qLines.forEach((line, i) => ctx.fillText(line, 12, 14 + i * 18));
  // Divider — 14px gap after question (matches height computation)
  const dividerY = 14 + qLines.length * 18 + 6;
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, dividerY);
  ctx.lineTo(s.width - 12, dividerY);
  ctx.stroke();
  // Steps — each step on its own line, starting 14px below divider
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#444";
  let y = dividerY + 14;
  for (const step of s.steps) {
    const ls = wrapText(ctx, step, s.width - 24);
    for (const l of ls) {
      ctx.fillText(l, 12, y);
      y += 16;
    }
  }
  // Answer — 10px gap after steps (matches height computation)
  y += 10;
  ctx.fillStyle = s.color;
  ctx.font = "700 14px Inter, system-ui, sans-serif";
  ctx.fillText(`= ${s.answer}`, 12, y);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  objs: CanvasObject[],
  ids: string[],
  vp: Viewport,
  theme: "light" | "dark",
) {
  const sel = objs.filter((o) => ids.includes(o.id));
  const bounds = computeSelectionBounds(sel);
  if (!bounds) return;
  const pad = 6 / vp.scale;
  const b = {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
  ctx.save();
  ctx.strokeStyle = theme === "dark" ? "#a3a3ff" : "#5b5bf0";
  ctx.lineWidth = 1.5 / vp.scale;
  ctx.setLineDash([6 / vp.scale, 4 / vp.scale]);
  ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  ctx.setLineDash([]);

  // Draw handles
  const hs = 10 / vp.scale;
  const handles: Point[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  ctx.fillStyle = theme === "dark" ? "#a3a3ff" : "#5b5bf0";
  ctx.strokeStyle = theme === "dark" ? "#fff" : "#fff";
  ctx.lineWidth = 1.5 / vp.scale;
  for (const h of handles) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, hs, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Rotate handle above top edge
  const rotPt = { x: (b.minX + b.maxX) / 2, y: b.minY - 24 / vp.scale };
  ctx.beginPath();
  ctx.arc(rotPt.x, rotPt.y, hs, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Line connecting rotate handle to box
  ctx.beginPath();
  ctx.moveTo((b.minX + b.maxX) / 2, b.minY);
  ctx.lineTo(rotPt.x, rotPt.y);
  ctx.stroke();
  ctx.restore();
}

function computeSelectionBounds(objs: CanvasObject[]) {
  if (objs.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    const b = objectBoundsLocal(o);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function applyScaleToSelection(
  snapshot: CanvasObject[],
  factor: number,
  cx: number,
  cy: number,
) {
  const store = useCanvasStore.getState();
  const newObjects = store.objects.map((o) => {
    if (!snapshot.find((s) => s.id === o.id)) return o;
    if (o.type === "stroke") {
      const snap = snapshot.find((s) => s.id === o.id) as Stroke;
      return {
        ...o,
        points: snap.points.map((p) => ({
          x: cx + (p.x - cx) * factor,
          y: cy + (p.y - cy) * factor,
        })),
        cached: snap.cached?.map((seg) => ({
          start: { x: cx + (seg.start.x - cx) * factor, y: cy + (seg.start.y - cy) * factor },
          cp1: { x: cx + (seg.cp1.x - cx) * factor, y: cy + (seg.cp1.y - cy) * factor },
          cp2: { x: cx + (seg.cp2.x - cx) * factor, y: cy + (seg.cp2.y - cy) * factor },
          end: { x: cx + (seg.end.x - cx) * factor, y: cy + (seg.end.y - cy) * factor },
        })),
        size: Math.max(0.5, snap.size * factor),
        bounds: snap.bounds
          ? {
              minX: cx + (snap.bounds.minX - cx) * factor,
              minY: cy + (snap.bounds.minY - cy) * factor,
              maxX: cx + (snap.bounds.maxX - cx) * factor,
              maxY: cy + (snap.bounds.maxY - cy) * factor,
            }
          : undefined,
      };
    }
    const snap = snapshot.find((s) => s.id === o.id) as
      | import("@/lib/canvas/types").TextObject
      | import("@/lib/canvas/types").SolverBox;
    return {
      ...o,
      x: cx + (snap.x - cx) * factor,
      y: cy + (snap.y - cy) * factor,
      width: Math.max(20, snap.width * factor),
      height: Math.max(20, snap.height * factor),
      fontSize: o.type === "text" ? Math.max(6, (snap as import("@/lib/canvas/types").TextObject).fontSize * factor) : (o as import("@/lib/canvas/types").SolverBox).height,
    };
  });
  useCanvasStore.setState({ objects: newObjects });
}

function applyRotationToSelection(
  snapshot: CanvasObject[],
  deltaRad: number,
  cx: number,
  cy: number,
) {
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  const store = useCanvasStore.getState();
  const newObjects = store.objects.map((o) => {
    if (!snapshot.find((s) => s.id === o.id)) return o;
    if (o.type === "stroke") {
      const snap = snapshot.find((s) => s.id === o.id) as Stroke;
      const rot = (p: Point) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
      };
      return {
        ...o,
        points: snap.points.map(rot),
        cached: snap.cached?.map((seg) => ({
          start: rot(seg.start),
          cp1: rot(seg.cp1),
          cp2: rot(seg.cp2),
          end: rot(seg.end),
        })),
        bounds: snap.bounds
          ? (() => {
              const corners = [
                { x: snap.bounds.minX, y: snap.bounds.minY },
                { x: snap.bounds.maxX, y: snap.bounds.minY },
                { x: snap.bounds.maxX, y: snap.bounds.maxY },
                { x: snap.bounds.minX, y: snap.bounds.maxY },
              ].map(rot);
              return {
                minX: Math.min(...corners.map((c) => c.x)),
                minY: Math.min(...corners.map((c) => c.y)),
                maxX: Math.max(...corners.map((c) => c.x)),
                maxY: Math.max(...corners.map((c) => c.y)),
              };
            })()
          : undefined,
      };
    }
    const snap = snapshot.find((s) => s.id === o.id) as
      | import("@/lib/canvas/types").TextObject
      | import("@/lib/canvas/types").SolverBox;
    const dx = snap.x - cx;
    const dy = snap.y - cy;
    return {
      ...o,
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
      rotation: snap.rotation + deltaRad,
    };
  });
  useCanvasStore.setState({ objects: newObjects });
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// silence unused import warning for buildSmoothedCache (kept for future use)
void buildSmoothedCache;
void worldToScreen;
