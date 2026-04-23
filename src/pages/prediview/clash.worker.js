/**
 * ClashWorker — Off-main-thread geometric collision detection.
 * No imports: runs as a classic Web Worker (no module type needed).
 *
 * Protocol
 * ────────
 * IN  { type:'CHECK', modelAId, modelBId, itemsA[], itemsB[] }
 *       Item: { localId, bbox:{minX,minY,minZ,maxX,maxY,maxZ}, triangles? }
 *       Triangle: [[x,y,z],[x,y,z],[x,y,z]]
 *
 * OUT { type:'PROGRESS', phase:'broad'|'narrow', done, total }
 *     { type:'CLASHES',  clashes:[{aLocalId,aModelId,bLocalId,bModelId}], candidateCount }
 */

// ── Vector helpers (plain arrays, no Three.js) ───────────────────────────────

function dot(a, b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function sub(a, b)   { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

// ── BROAD PHASE — Axis-Aligned Bounding Box ──────────────────────────────────

/**
 * Returns the minimum penetration depth across all 3 axes.
 * Positive value = overlap amount in the most-easily-separated direction.
 * Negative / zero = no intersection.
 *
 * Replaces a simple boolean test so we can filter by tolerance:
 *   depth > 0          → any intersection (hard clash, tolerance=0)
 *   depth > tolerance  → only overlaps deeper than threshold (soft-clash filter)
 */
function aabbOverlapDepth(a, b) {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (ox <= 0 || oy <= 0 || oz <= 0) return -1; // no intersection
  return Math.min(ox, oy, oz); // penetration depth in easiest-escape direction
}

// ── NARROW PHASE — Triangle-Triangle SAT (Möller 1997) ───────────────────────

/**
 * Returns true when two triangles geometrically intersect.
 * Tests 13 separation axes: 2 face normals + 9 edge×edge cross-products.
 * @param {[[number,number,number],[number,number,number],[number,number,number]]} t1
 * @param {[[number,number,number],[number,number,number],[number,number,number]]} t2
 */
function trianglesIntersect(t1, t2) {
  // Face normals
  const n1 = cross(sub(t1[1], t1[0]), sub(t1[2], t1[0]));
  const n2 = cross(sub(t2[1], t2[0]), sub(t2[2], t2[0]));

  // Edge vectors
  const e1 = [sub(t1[1],t1[0]), sub(t1[2],t1[1]), sub(t1[0],t1[2])];
  const e2 = [sub(t2[1],t2[0]), sub(t2[2],t2[1]), sub(t2[0],t2[2])];

  const axes = [n1, n2];
  for (const a of e1) {
    for (const b of e2) {
      const ax = cross(a, b);
      if (ax[0]*ax[0] + ax[1]*ax[1] + ax[2]*ax[2] > 1e-12) axes.push(ax);
    }
  }

  for (const ax of axes) {
    const p1 = [dot(t1[0],ax), dot(t1[1],ax), dot(t1[2],ax)];
    const p2 = [dot(t2[0],ax), dot(t2[1],ax), dot(t2[2],ax)];
    if (Math.max(...p1) < Math.min(...p2) || Math.max(...p2) < Math.min(...p1)) {
      return false; // separating axis found → no intersection
    }
  }
  return true;
}

// ── MESSAGE HANDLER ───────────────────────────────────────────────────────────

self.onmessage = function ({ data }) {
  const { type, modelAId, modelBId, itemsA, itemsB, tolerance = 0 } = data;
  if (type !== 'CHECK') return;

  // ── BROAD PHASE ──────────────────────────────────────────────────────────
  const candidates = [];
  for (const a of itemsA) {
    for (const b of itemsB) {
      if (aabbOverlapDepth(a.bbox, b.bbox) > tolerance) candidates.push([a, b]);
    }
  }
  self.postMessage({ type: 'PROGRESS', phase: 'broad', done: candidates.length, total: candidates.length });

  // ── NARROW PHASE ─────────────────────────────────────────────────────────
  const clashes = [];

  for (let i = 0; i < candidates.length; i++) {
    const [a, b] = candidates[i];

    let isClash;
    if (a.triangles && a.triangles.length > 0 && b.triangles && b.triangles.length > 0) {
      // Triangle-level precision
      isClash = false;
      outer: for (const ta of a.triangles) {
        for (const tb of b.triangles) {
          if (trianglesIntersect(ta, tb)) { isClash = true; break outer; }
        }
      }
    } else {
      // AABB-only run: every candidate is a clash
      isClash = true;
    }

    if (isClash) {
      clashes.push({
        aLocalId: a.localId,
        aModelId: modelAId,
        bLocalId: b.localId,
        bModelId: modelBId,
      });
    }

    if (i % 100 === 0) {
      self.postMessage({ type: 'PROGRESS', phase: 'narrow', done: i + 1, total: candidates.length });
    }
  }

  self.postMessage({ type: 'CLASHES', clashes, candidateCount: candidates.length });
};
