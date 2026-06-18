/**
 * Stroke smoothing using Catmull-Rom spline converted to cubic Bezier segments.
 * This produces natural, smooth handwriting with low latency.
 *
 * Pipeline:
 *   raw points → light low-pass filter (jitter reduction)
 *              → Catmull-Rom → cubic Bezier (cached)
 *              → drawn with ctx.bezierCurveTo
 */

import type { BezierSegment, Point, Stroke } from "./types";

/**
 * Light low-pass filter to reduce micro-jitter from touch sampling.
 * Each point (except endpoints) is moved slightly toward the previous point.
 */
export function smoothPoints(points: Point[], strength = 0.35): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    out.push({
      x: curr.x + (prev.x - curr.x) * strength,
      y: curr.y + (prev.y - curr.y) * strength,
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Convert a polyline of points into a series of cubic Bezier segments
 * using the Catmull-Rom spline formulation.
 *
 * For each segment between P[i] and P[i+1], the Bezier control points are:
 *   CP1 = P[i] + (P[i+1] - P[i-1]) / 6
 *   CP2 = P[i+1] - (P[i+2] - P[i]) / 6
 *
 * Tension parameter 0.5 = standard Catmull-Rom.
 */
export function catmullRomToBezier(points: Point[], tension = 0.5): BezierSegment[] {
  if (points.length < 2) return [];
  if (points.length === 2) {
    // Straight line - simulate a degenerate Bezier
    const p0 = points[0];
    const p1 = points[1];
    const mid1 = { x: p0.x + (p1.x - p0.x) / 3, y: p0.y + (p1.y - p0.y) / 3 };
    const mid2 = { x: p0.x + (2 * (p1.x - p0.x)) / 3, y: p0.y + (2 * (p1.y - p0.y)) / 3 };
    return [{ start: p0, cp1: mid1, cp2: mid2, end: p1 }];
  }

  const segments: BezierSegment[] = [];
  // Pad with phantom endpoints so the first/last segments work
  const p = [points[0], ...points, points[points.length - 1]];
  const k = tension * 2; // 1.0 for standard

  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2];

    const cp1 = {
      x: p1.x + (p2.x - p0.x) / 6 / k,
      y: p1.y + (p2.y - p0.y) / 6 / k,
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / 6 / k,
      y: p2.y - (p3.y - p1.y) / 6 / k,
    };
    segments.push({ start: p1, cp1, cp2, end: p2 });
  }
  return segments;
}

/**
 * Full smoothing pipeline applied when a stroke is committed (pointer up).
 * Stores cached Bezier segments on the stroke for fast subsequent rendering.
 */
export function buildSmoothedCache(points: Point[]): BezierSegment[] {
  if (points.length === 0) return [];
  const filtered = smoothPoints(points, 0.3);
  return catmullRomToBezier(filtered, 0.5);
}

/**
 * Incremental smoothing: produce a single Bezier segment for the latest 3 points.
 * Used during active drawing for immediate smooth feedback without re-smoothing
 * the entire stroke every frame.
 *
 * Returns a partial path the renderer can append to the existing cached segments.
 */
export function incrementalBezier(prev: Point[], current: Point): BezierSegment | null {
  if (prev.length < 2) return null;
  const n = prev.length;
  const p0 = prev[n - 2];
  const p1 = prev[n - 1];
  const p2 = current;
  // Phantom p3 mirrors p2-p1
  const p3 = { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) };
  const cp1 = {
    x: p1.x + (p2.x - p0.x) / 12,
    y: p1.y + (p2.y - p0.y) / 12,
  };
  const cp2 = {
    x: p2.x - (p3.x - p1.x) / 12,
    y: p2.y - (p3.y - p1.y) / 12,
  };
  return { start: p1, cp1, cp2, end: p2 };
}

/**
 * Estimate a stroke's bounding box (world coords), padded by the stroke size.
 */
export function strokeBounds(stroke: Stroke): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (stroke.points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = stroke.size;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
