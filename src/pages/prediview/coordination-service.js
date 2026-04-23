/**
 * CoordinationService
 * ═══════════════════
 * Orchestrates multi-model BIM coordination for PrediBuild prediView.
 *
 * Responsibilities:
 *   1. applyBaseCoordinateSystem() — align MEP model to Structural coordinate space
 *   2. extractElementData()       — extract per-element AABB (+ optional mesh triangles)
 *   3. indexStoreys()             — map element IDs → IfcBuildingStorey via IfcRelationsIndexer
 *   4. detectClashes()            — dispatch to clash.worker.js, return results
 */

import * as THREE from 'three';
import * as OBC from '@thatopen/components';

export class CoordinationService {
  /**
   * @param {OBC.Components}       components
   * @param {OBC.FragmentsManager} fragments
   */
  constructor(components, fragments) {
    this.components = components;
    this.fragments  = fragments;

    /** @type {Worker|null} */
    this._worker = null;

    /**
     * "modelId:localId" → storeyName  (populated lazily by getStoreyName)
     * @type {Map<string,string>}
     */
    this._storeyMap = new Map();

    /**
     * Set of modelIds whose IfcRelationsIndexer has already been processed.
     * @type {Set<string>}
     */
    this._processedModels = new Set();

    /**
     * "modelId:localId" → plain bbox  (populated by extractElementData)
     * @type {Map<string,{minX,minY,minZ,maxX,maxY,maxZ}>}
     */
    this._bboxCache = new Map();

    /** Optional progress callback set via onProgress(fn) */
    this._progressCb = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. COORDINATE ALIGNMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Aligns targetModel's world position to baseModel's coordinate space.
   *
   * Strategy: compute the centroid offset between both model bounding boxes.
   * When models share the same IFC survey origin, offset ≈ 0 and no change is applied.
   * When they diverge (> 1 m), a translation is applied to the target object.
   *
   * @param {string} baseModelId   - Structural model (reference, unchanged)
   * @param {string} targetModelId - MEP model (will be repositioned)
   */
  applyBaseCoordinateSystem(baseModelId, targetModelId) {
    const base   = this.fragments.list.get(baseModelId);
    const target = this.fragments.list.get(targetModelId);

    if (!base || !target) {
      console.warn('[CoordinationService] applyBaseCoordinateSystem: model not found');
      return;
    }

    const baseBox   = new THREE.Box3().setFromObject(base.object);
    const targetBox = new THREE.Box3().setFromObject(target.object);

    if (baseBox.isEmpty() || targetBox.isEmpty()) {
      console.warn('[CoordinationService] applyBaseCoordinateSystem: empty bounding box');
      return;
    }

    const baseCenter   = baseBox.getCenter(new THREE.Vector3());
    const targetCenter = targetBox.getCenter(new THREE.Vector3());
    const offset       = baseCenter.clone().sub(targetCenter);

    if (offset.length() > 1.0) {
      target.object.position.add(offset);
      target.object.updateMatrixWorld(true);
      console.log(
        `[CoordinationService] Coordinate alignment applied — offset ${offset.length().toFixed(3)} m`,
        offset,
      );
    } else {
      console.log('[CoordinationService] Models already share coordinate space (offset < 1 m)');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GEOMETRY EXTRACTION  (runs on main thread before dispatching to worker)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extracts per-element bounding boxes and optional triangle samples from a model.
   *
   * Handles both InstancedMesh (fragment models) and regular Mesh objects.
   * Falls back to uuid-based IDs when the fragment API is unavailable.
   *
   * @param {string}  modelId
   * @param {boolean} [includeTriangles=false] - Set true for narrow-phase precision
   * @returns {Array<{localId:number|string, bbox:{minX,minY,minZ,maxX,maxY,maxZ}, triangles?}>}
   */
  async extractElementData(modelId, includeTriangles = false) {
    const model = this.fragments.list.get(modelId);
    if (!model) return [];

    model.object.updateMatrixWorld(true);

    // @thatopen/fragments v3.3.6 ID system:
    //   localId  = internal sequential index (0, 1, 2, …) — used by ALL public APIs
    //              (getBoxes, highlight, setOpacity, resetOpacity, getItemsData…)
    //   itemId   = IFC ExpressID — stored in visibleItems / tile userData.itemIds
    //
    // model.traverse(undefined, cb) enumerates every localId via traverseAllItems.
    // model.getBoxes(localIds) fetches per-element Box3[] from the worker (world space).

    const localIds = [];
    model.traverse(undefined, (localId) => { localIds.push(localId); });

    if (localIds.length === 0) {
      console.warn(`[CoordinationService] extractElementData: no localIds for "${modelId}"`);
      return [];
    }

    const boxes = await model.getBoxes(localIds);  // Box3[] in world space

    const items = [];
    for (let i = 0; i < localIds.length; i++) {
      const localId = localIds[i];
      const bbox = boxes[i];
      if (!bbox || bbox.isEmpty()) continue;

      const plainBbox = this._boxToPlain(bbox);
      this._bboxCache.set(`${modelId}:${localId}`, plainBbox);
      items.push({ localId, bbox: plainBbox });
    }

    console.log(
      `[CoordinationService] extractElementData "${modelId}": ${items.length} items ` +
      `(traversed ${localIds.length} localIds),`,
      `sample IDs:`, items.slice(0, 5).map(i => `${i.localId} (${typeof i.localId})`),
    );

    return items;
  }

  /**
   * Returns the cached bounding box for a single element, or null if not yet extracted.
   * The cache is populated automatically when detectClashes() is called.
   * @param {string}        modelId
   * @param {number|string} localId
   */
  getElementBbox(modelId, localId) {
    return this._bboxCache.get(`${modelId}:${localId}`) ?? null;
  }

  /** Converts a THREE.Box3 to a plain serialisable object. */
  _boxToPlain(box) {
    return {
      minX: box.min.x, minY: box.min.y, minZ: box.min.z,
      maxX: box.max.x, maxY: box.max.y, maxZ: box.max.z,
    };
  }

  /**
   * Samples up to `maxTris` triangles from a BufferGeometry, transformed to world space.
   * Uses stride sampling so large geometries are still represented.
   */
  _sampleTriangles(geom, worldMatrix, maxTris = 40) {
    const posAttr  = geom.getAttribute('position');
    if (!posAttr) return [];

    const index    = geom.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(posAttr.count / 3);
    const step     = Math.max(1, Math.floor(triCount / maxTris));
    const tris     = [];

    for (let i = 0; i < triCount && tris.length < maxTris; i += step) {
      const ia = index ? index.getX(i * 3)     : i * 3;
      const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;

      const vA = new THREE.Vector3().fromBufferAttribute(posAttr, ia).applyMatrix4(worldMatrix);
      const vB = new THREE.Vector3().fromBufferAttribute(posAttr, ib).applyMatrix4(worldMatrix);
      const vC = new THREE.Vector3().fromBufferAttribute(posAttr, ic).applyMatrix4(worldMatrix);

      tris.push([
        [vA.x, vA.y, vA.z],
        [vB.x, vB.y, vB.z],
        [vC.x, vC.y, vC.z],
      ]);
    }

    return tris;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. STOREY INDEXING  (IfcRelationsIndexer)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Pre-warms the IfcRelationsIndexer for a model so that subsequent getStoreyName()
   * calls resolve from cache without an await. Safe to call multiple times.
   * @param {string} modelId
   */
  async indexStoreys(modelId) {
    const model = this.fragments.list.get(modelId);
    if (!model || this._processedModels.has(modelId)) return;
    try {
      // IfcRelationsIndexer is not available in @thatopen/components v3.3.3.
      // Guard against missing class to avoid noisy console errors.
      if (!OBC.IfcRelationsIndexer) {
        this._processedModels.add(modelId);
        return;
      }
      const indexer = this.components.get(OBC.IfcRelationsIndexer);
      await indexer.process(model);
      this._processedModels.add(modelId);
      console.log(`[CoordinationService] IfcRelationsIndexer ready for "${modelId}"`);
    } catch (err) {
      console.warn('[CoordinationService] IfcRelationsIndexer unavailable:', err.message);
      this._processedModels.add(modelId); // prevent repeated attempts
    }
  }

  /**
   * Async lazy storey lookup.
   * - If the answer is already cached, resolves synchronously from the cache.
   * - If the indexer hasn't been run yet for this model, runs it first.
   * - Tries multiple v3 API variants for robustness.
   * @param {string}        modelId
   * @param {number|string} localId
   * @returns {Promise<string>} IfcBuildingStorey name, or 'Sin nivel'
   */
  async getStoreyName(modelId, localId) {
    const key = `${modelId}:${localId}`;
    if (this._storeyMap.has(key)) return this._storeyMap.get(key);

    const model = this.fragments.list.get(modelId);
    if (!model) return 'Sin nivel';

    // Ensure the indexer has processed this model
    if (!this._processedModels.has(modelId)) {
      try {
        const indexer = this.components.get(OBC.IfcRelationsIndexer);
        await indexer.process(model);
        this._processedModels.add(modelId);
      } catch (err) {
        console.warn('[CoordinationService] IfcRelationsIndexer failed:', err.message);
        this._storeyMap.set(key, 'Sin nivel');
        return 'Sin nivel';
      }
    }

    try {
      const indexer = this.components.get(OBC.IfcRelationsIndexer);

      // Try all known v3 API variants
      let storeyIds = null;
      if (typeof indexer.getEntityRelations === 'function') {
        storeyIds = indexer.getEntityRelations(model, localId, 'ContainedInStructure');
      } else if (typeof indexer.getRelations === 'function') {
        storeyIds = indexer.getRelations(model, localId, 'ContainedInStructure');
      }

      if (!storeyIds || storeyIds.size === 0) {
        this._storeyMap.set(key, 'Sin nivel');
        return 'Sin nivel';
      }

      // storeyIds contains either the storey expressIDs directly, or
      // IfcRelContainedInSpatialStructure expressIDs. Try both interpretations.
      const candidateId = [...storeyIds][0];
      const [data] = await model.getItemsData([candidateId]) ?? [null];

      // Case 1: data IS the IfcBuildingStorey (direct hit)
      const directName = data?.LongName?.value ?? data?.Name?.value;
      if (directName) {
        this._storeyMap.set(key, directName);
        return directName;
      }

      // Case 2: data is the IfcRelContainedInSpatialStructure entity
      const relatingId = data?.RelatingStructure?.value;
      if (relatingId != null) {
        const [storeyData] = await model.getItemsData([relatingId]) ?? [null];
        const name = storeyData?.LongName?.value ?? storeyData?.Name?.value ?? 'Sin nivel';
        this._storeyMap.set(key, name);
        return name;
      }
    } catch (_) { /* non-critical */ }

    this._storeyMap.set(key, 'Sin nivel');
    return 'Sin nivel';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. CLASH DETECTION  (delegates heavy math to clash.worker.js)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Runs off-thread clash detection between two loaded models.
   *
   * Two-phase pipeline:
   *   Broad  (AABB)     — fast n² bbox overlap test in the worker
   *   Narrow (triangle) — SAT triangle-triangle test on AABB candidates
   *
   * @param {string}  modelAId   - Structural model ID
   * @param {string}  modelBId   - MEP model ID
   * @param {boolean} [narrowPhase=false] - Enable triangle-level precision (slower)
   * @param {number}  [tolerance=0]       - Minimum AABB penetration depth (m) to report as clash.
   *                                        0 = any overlap (hard clash), > 0 = soft-clash threshold.
   * @returns {Promise<Array<{aLocalId, aModelId, bLocalId, bModelId}>>}
   */
  async detectClashes(modelAId, modelBId, narrowPhase = false, tolerance = 0) {
    const itemsA = await this.extractElementData(modelAId, narrowPhase);
    const itemsB = await this.extractElementData(modelBId, narrowPhase);

    if (itemsA.length === 0 || itemsB.length === 0) {
      return [];
    }

    console.log(
      `[CoordinationService] Clash check: ${itemsA.length} (A) × ${itemsB.length} (B) elements`,
      narrowPhase ? '[narrow phase ON]' : '[broad phase only]',
    );

    return new Promise((resolve, reject) => {
      // Reuse worker across calls; lazy-initialise
      if (!this._worker) {
        this._worker = new Worker(
          new URL('./clash.worker.js', import.meta.url)
        );
      }

      const onMsg = (e) => {
        const msg = e.data;
        if (msg.type === 'PROGRESS') {
          this._progressCb?.(msg);
          return;
        }
        if (msg.type === 'CLASHES') {
          this._worker.removeEventListener('message', onMsg);
          this._worker.removeEventListener('error', onErr);
          console.log(
            `[CoordinationService] ${msg.candidateCount} AABB candidates → ${msg.clashes.length} real clashes`,
          );
          resolve(msg.clashes);
        }
      };

      const onErr = (err) => {
        this._worker.removeEventListener('message', onMsg);
        this._worker.removeEventListener('error', onErr);
        reject(new Error(`clash.worker error: ${err.message}`));
      };

      this._worker.addEventListener('message', onMsg);
      this._worker.addEventListener('error', onErr);
      this._worker.postMessage({ type: 'CHECK', modelAId, modelBId, itemsA, itemsB, tolerance });
    });
  }

  /**
   * Register a callback for worker progress events.
   * @param {(msg:{phase:string, done:number, total:number}) => void} fn
   */
  onProgress(fn) {
    this._progressCb = fn;
  }

  dispose() {
    this._worker?.terminate();
    this._worker = null;
    this._storeyMap.clear();
  }
}
