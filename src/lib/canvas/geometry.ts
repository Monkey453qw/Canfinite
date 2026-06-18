/**
 * Geometry helpers: viewport transforms, bounds, hit detection.
 */

import type {
  Bounds,
  CanvasObject,
  Point,
  Stroke,
  TextObject,
  SolverBox,
  Viewport,
} from "./types";

/** Convert a screen-space point to world space. */
export function screenToWorld(screen: Point, vp: Viewport): Point {
  return {
    x: (screen.x - vp.x) / vp.scale,
    y: (screen.y - vp.y) / vp.scale,
  };
}

/** Convert a world-space point to screen space. */
export function worldToScreen(world: Point, vp: Viewport): Point {
  return {
    x: world.x * vp.scale + vp.x,
    y: world.y * vp.scale + vp.y,
  };
}

/** Compute the world-space bounds visible through the screen. */
export function visibleWorldBounds(
  width: number,
  height: number,
  vp: Viewport,
): Bounds {
  const tl = screenToWorld({ x: 0, y: 0 }, vp);
  const br = screenToWorld({ x: width, y: height }, vp);
  return {
    minX: tl.x,
    minY: tl.y,
    maxX: br.x,
    maxY: br.y,
  };
}

/** Test whether two bounds overlap (used for viewport culling). */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/** Compute the union bounds of multiple objects. */
export function unionBounds(objs: CanvasObject[]): Bounds | null {
  if (objs.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const o of objs) {
    const b = objectBounds(o);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Get the bounds of any canvas object. */
export function objectBounds(o: CanvasObject): Bounds | null {
  if (o.type === "stroke") {
    return o.bounds ?? null;
  }
  // text/solver: axis-aligned bounds (rotation ignored for culling; padded)
  const pad = 4;
  const cos = Math.abs(Math.cos(o.rotation));
  const sin = Math.abs(Math.sin(o.rotation));
  const w = o.width * cos + o.height * sin + pad * 2;
  const h = o.width * sin + o.height * cos + pad * 2;
  const cx = o.x + o.width / 2;
  const cy = o.y + o.height / 2;
  return {
    minX: cx - w / 2,
    minY: cy - h / 2,
    maxX: cx + w / 2,
    maxY: cy + h / 2,
  };
}

/** Distance from a point to a line segment (a, b). */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Sample a Bezier segment at parameter t (0..1) using De Casteljau.
 */
function bezierAt(seg: { start: Point; cp1: Point; cp2: Point; end: Point }, t: number): Point {
  const mt = 1 - t;
  const x =
    mt * mt * mt * seg.start.x +
    3 * mt * mt * t * seg.cp1.x +
    3 * mt * t * t * seg.cp2.x +
    t * t * t * seg.end.x;
  const y =
    mt * mt * mt * seg.start.y +
    3 * mt * mt * t * seg.cp1.y +
    3 * mt * t * t * seg.cp2.y +
    t * t * t * seg.end.y;
  return { x, y };
}

/**
 * Test if a world-space point hits a stroke.
 * Walks each cached Bezier segment, sampling a handful of points and
 * checking distance to the resulting line segments.
 */
export function hitTestStroke(stroke: Stroke, p: Point, tolerance: number): boolean {
  const tol = tolerance + stroke.size / 2;
  const segs = stroke.cached;
  if (segs && segs.length > 0) {
    for (const seg of segs) {
      // Sample 8 sub-points per segment
      let prev = seg.start;
      for (let i = 1; i <= 8; i++) {
        const cur = bezierAt(seg, i / 8);
        if (distToSegment(p, prev, cur) <= tol) return true;
        prev = cur;
      }
    }
    return false;
  }
  // Fallback: raw points
  for (let i = 0; i < stroke.points.length - 1; i++) {
    if (distToSegment(p, stroke.points[i], stroke.points[i + 1]) <= tol) return true;
  }
  return false;
}

/** Hit test for text/solver box (rotation-aware). `pad` expands the hit area
 *  in world units — useful for finger-friendly selection on touch devices. */
export function hitTestBox(
  obj: TextObject | SolverBox,
  p: Point,
  pad = 0,
): boolean {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const cos = Math.cos(-obj.rotation);
  const sin = Math.sin(-obj.rotation);
  // Translate to origin then un-rotate
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const halfW = obj.width / 2 + pad;
  const halfH = obj.height / 2 + pad;
  return (
    lx >= -halfW &&
    lx <= halfW &&
    ly >= -halfH &&
    ly <= halfH
  );
}

/** Top-level hit test against any object. Returns the topmost hit id or null.
 *  `tolerance` is also used as padding for box hit areas (finger-friendly). */
export function hitTestObject(
  objs: CanvasObject[],
  p: Point,
  tolerance: number,
): string | null {
  // Iterate topmost-first (last drawn = topmost)
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o.type === "stroke") {
      if (hitTestStroke(o, p, tolerance)) return o.id;
    } else {
      // Pad box hit area by tolerance so taps near the edge still register.
      if (hitTestBox(o, p, tolerance)) return o.id;
    }
  }
  return null;
}

/**
 * Hit test for selection handles. Returns which handle was hit, or null.
 * Handle positions are: corners (nw, ne, se, sw) for resize, plus a rotate handle above.
 */
export type HandleId = "nw" | "ne" | "se" | "sw" | "rotate" | "body";

export function hitTestHandle(
  bounds: Bounds,
  worldPoint: Point,
  handleSize: number,
): HandleId | null {
  const { minX, minY, maxX, maxY } = bounds;
  const h = handleSize;
  const corners: { id: HandleId; p: Point }[] = [
    { id: "nw", p: { x: minX, y: minY } },
    { id: "ne", p: { x: maxX, y: minY } },
    { id: "se", p: { x: maxX, y: maxY } },
    { id: "sw", p: { x: minX, y: maxY } },
  ];
  for (const c of corners) {
    if (Math.abs(worldPoint.x - c.p.x) <= h && Math.abs(worldPoint.y - c.p.y) <= h) {
      return c.id;
    }
  }
  // Rotate handle: above the top edge, centered
  const rotPt = { x: (minX + maxX) / 2, y: minY - h * 2 };
  if (Math.hypot(worldPoint.x - rotPt.x, worldPoint.y - rotPt.y) <= h * 1.2) {
    return "rotate";
  }
  // Body hit
  if (
    worldPoint.x >= minX &&
    worldPoint.x <= maxX &&
    worldPoint.y >= minY &&
    worldPoint.y <= maxY
  ) {
    return "body";
  }
  return null;
}

/** Distance between two pointers (for pinch-zoom). */
export function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint between two pointers (for pan tracking). */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point {x, y} is inside the polygon defined by `polygon`
 * (an array of points). The polygon is treated as implicitly closed
 * (last point connects to first).
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Test whether a canvas object is inside a lasso polygon.
 * - Strokes: selected if ANY point is inside the polygon.
 * - Text/Solver boxes: selected if the center is inside.
 */
export function objectInPolygon(o: import("./types").CanvasObject, polygon: Point[]): boolean {
  if (o.type === "stroke") {
    for (const p of o.points) {
      if (pointInPolygon(p, polygon)) return true;
    }
    return false;
  }
  // Text / SolverBox
  const cx = o.x + o.width / 2;
  const cy = o.y + o.height / 2;
  return pointInPolygon({ x: cx, y: cy }, polygon);
}
