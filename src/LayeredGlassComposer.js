import { AnalyticLayeredGlassComposer } from './AnalyticLayeredGlassComposer.js';
import { BVHLayeredGlassComposer } from './BVHLayeredGlassComposer.js';
import { resolveLayeredGlassQuality } from './ray-scene/RayScene.js';

const BACKENDS = new Set(['auto', 'analytic', 'bvh']);

/**
 * Public composer facade.
 *
 * - `analytic`: 0.3 analytic primitives and explicit proxies.
 * - `bvh`: static triangle BVH for arbitrary BufferGeometry and automatic
 *   opaque intersections.
 * - `auto`: analytic while preparing, then BVH after `prepare()` resolves.
 */
export class LayeredGlassComposer {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.backend = options.backend ?? 'auto';
    if (!BACKENDS.has(this.backend)) {
      throw new RangeError(`Unknown layered-glass backend "${this.backend}".`);
    }

    this._options = { ...options };
    this.layered = options.layered ?? true;
    this.autoDiscover = options.autoDiscover ?? true;
    this.autoDiscoverBlockers = options.autoDiscoverBlockers ?? true;
    this.autoOpaqueIntersections = options.autoOpaqueIntersections ?? true;
    this.foregroundLayer = options.foregroundLayer ?? null;
    this.renderToScreen = options.renderToScreen ?? true;
    this.depthMode = options.depthMode ?? 'opaque';
    this.manageRendererInfo = options.manageRendererInfo ?? true;
    this._analytic = null;
    this._bvh = null;
    this._registeredObjects = new Set();
    this._registeredForeground = new Set();
    this._rayVisibilityOverrides = new Map();
  }

  _getAnalytic() {
    if (!this._analytic) {
      this._analytic = new AnalyticLayeredGlassComposer(this.renderer, {
        ...this._options,
        renderToScreen: this._options.renderToScreen ?? true,
      });
      for (const object of this._registeredObjects) this._analytic.add(object);
      for (const object of this._registeredForeground) this._analytic.addForeground(object);
      for (const [object, visibility] of this._rayVisibilityOverrides) {
        if (visibility === 'opaque') {
          this._analytic.addBlocker(
            object,
            object.userData?.layeredGlass?.intersectionProxy ?? {},
          );
        }
      }
    }
    return this._analytic;
  }

  _getBVH() {
    if (!this._bvh) {
      this._bvh = new BVHLayeredGlassComposer(this.renderer, {
        ...this._options,
        renderToScreen: this._options.renderToScreen ?? true,
      });
      for (const object of this._registeredObjects) this._bvh.add(object);
      for (const object of this._registeredForeground) this._bvh.addForeground(object);
      for (const [object, visibility] of this._rayVisibilityOverrides) {
        this._bvh.setRayVisibility(object, visibility);
      }
    }
    return this._bvh;
  }

  get activeBackend() {
    if (this.backend === 'analytic') return 'analytic';
    if (this.backend === 'bvh') return 'bvh';
    return this._bvh?.ready ? 'bvh' : 'analytic';
  }

  get ready() {
    return this.backend === 'analytic' || Boolean(this._bvh?.ready);
  }

  get building() {
    return Boolean(this._bvh?.building);
  }

  get rayScene() {
    return this._bvh?.rayScene ?? null;
  }

  get outputTexture() {
    return this._activeComposer()?.outputTexture ?? null;
  }

  get outputRenderTarget() {
    return this._activeComposer()?.outputRenderTarget ?? null;
  }

  get depthTexture() {
    return this._activeComposer()?.depthTexture ?? null;
  }

  get opaqueDepthTexture() {
    return this._activeComposer()?.opaqueDepthTexture ?? null;
  }

  get width() {
    return this._activeComposer()?.width ?? 1;
  }

  get height() {
    return this._activeComposer()?.height ?? 1;
  }

  get resolutionScale() {
    if (this._bvh) return this._bvh.resolutionScale;
    return this._options.resolutionScale ?? resolveLayeredGlassQuality(
      this._options.quality ?? 'medium',
      this._options.qualityOverrides,
    ).resolutionScale;
  }

  get coverageScale() {
    return this._bvh?.coverageScale ?? this._options.coverageScale ?? 1;
  }

  get coverageSamples() {
    return this._bvh?.coverageSamples ?? this._options.coverageSamples ?? 0;
  }

  get transmissionAntialias() {
    return this._bvh?.transmissionAntialias
      ?? Boolean(this._options.transmissionAntialias);
  }

  _activeComposer() {
    return this.activeBackend === 'bvh' ? this._getBVH() : this._getAnalytic();
  }

  async prepare(scene, options = {}) {
    if (this.backend === 'analytic') return this;
    await this._getBVH().prepare(scene, options);
    return this;
  }

  invalidateScene() {
    this._bvh?.invalidateScene();
    return this;
  }

  invalidateGeometry(object) {
    this._bvh?.invalidateGeometry(object);
    return this;
  }

  invalidateMaterial(object) {
    this._bvh?.invalidateMaterial(object);
    return this;
  }

  setRayVisibility(object, visibility = 'auto') {
    if (visibility === 'auto') this._rayVisibilityOverrides.delete(object);
    else this._rayVisibilityOverrides.set(object, visibility);
    this._bvh?.setRayVisibility(object, visibility);
    if (this._analytic) {
      if (visibility === 'opaque') {
        this._analytic.addBlocker(
          object,
          object.userData?.layeredGlass?.intersectionProxy ?? {},
        );
      } else {
        this._analytic.removeBlocker?.(object);
      }
    }
    return this;
  }

  setIntersectionProxy(object, proxy = {}) {
    object.userData.layeredGlass ??= {};
    object.userData.layeredGlass.intersectionProxy = { ...proxy };

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material?.isLayeredGlassMaterial) continue;
      if (proxy.shape != null) material.shape = proxy.shape;
      if (proxy.radius != null) material.radius = proxy.radius;
      if (proxy.halfExtents != null) material.halfExtents = proxy.halfExtents;
      if (proxy.center != null) material.center = proxy.center;
    }

    this._analytic?.add(object);
    return this;
  }

  add(...objects) {
    objects.forEach((object) => this._registeredObjects.add(object));
    this._analytic?.add(...objects);
    this._bvh?.add(...objects);
    return this;
  }

  remove(...objects) {
    objects.forEach((object) => this._registeredObjects.delete(object));
    this._analytic?.remove(...objects);
    this._bvh?.remove(...objects);
    return this;
  }

  clear() {
    this._registeredObjects.clear();
    this._analytic?.clear();
    this._bvh?.clear();
    return this;
  }

  /** @deprecated Opaque meshes are automatic in the BVH backend. */
  addBlocker(object, options = {}) {
    if (options.shape || options.radius || options.halfExtents || options.center) {
      object.userData.layeredGlass ??= {};
      object.userData.layeredGlass.intersectionProxy = options;
    }
    return this.setRayVisibility(object, 'opaque');
  }

  addBlockers(...objects) { objects.forEach((object) => this.addBlocker(object)); return this; }
  addOpaque(object, options) { return this.addBlocker(object, options); }
  removeBlocker(...objects) { objects.forEach((object) => this.setRayVisibility(object, 'auto')); return this; }
  removeOpaque(...objects) { return this.removeBlocker(...objects); }
  clearBlockers() {
    for (const [object, visibility] of [...this._rayVisibilityOverrides]) {
      if (visibility === 'opaque') this.setRayVisibility(object, 'auto');
    }
    return this;
  }

  addForeground(...objects) {
    objects.forEach((object) => this._registeredForeground.add(object));
    this._analytic?.addForeground(...objects);
    this._bvh?.addForeground(...objects);
    return this;
  }

  removeForeground(...objects) {
    objects.forEach((object) => this._registeredForeground.delete(object));
    this._analytic?.removeForeground(...objects);
    this._bvh?.removeForeground(...objects);
    return this;
  }

  clearForeground() {
    this._registeredForeground.clear();
    this._analytic?.clearForeground();
    this._bvh?.clearForeground();
    return this;
  }

  setSize(width, height) {
    this._analytic?.setSize(width, height);
    this._bvh?.setSize(width, height);
    return this;
  }

  setResolutionScale(value) {
    const nextValue = Math.min(1, Math.max(0.1, Number(value)));
    if (!Number.isFinite(nextValue)) return this;
    this._options.resolutionScale = nextValue;
    this._bvh?.setResolutionScale(nextValue);
    return this;
  }

  setCoverageScale(value) {
    const nextValue = Math.min(1, Math.max(0.25, Number(value)));
    if (!Number.isFinite(nextValue)) return this;
    this._options.coverageScale = nextValue;
    this._bvh?.setCoverageScale(nextValue);
    return this;
  }

  setCoverageSamples(value) {
    const nextValue = Math.min(
      this.renderer.capabilities.maxSamples ?? 0,
      Math.max(0, Math.floor(Number(value))),
    );
    if (!Number.isFinite(nextValue)) return this;
    this._options.coverageSamples = nextValue;
    this._bvh?.setCoverageSamples(nextValue);
    return this;
  }

  setTransmissionAntialias(value) {
    const nextValue = Boolean(value);
    this._options.transmissionAntialias = nextValue;
    this._bvh?.setTransmissionAntialias(nextValue);
    return this;
  }

  render(scene, camera, options = {}) {
    if (this.backend === 'auto' && !this._bvh?.ready) {
      this._getBVH().prepare(scene).catch((error) => {
        console.error('LayeredGlass BVH preparation failed.', error);
      });
    }

    const composer = this._activeComposer();
    this._syncMutableOptions(composer);

    if (this.backend === 'auto' && composer === this._analytic) {
      try {
        return composer.render(scene, camera, options);
      } catch (error) {
        console.warn(
          'Analytic fallback could not represent this scene; using the BVH base fallback while preparation completes.',
          error,
        );
        const bvh = this._getBVH();
        this._syncMutableOptions(bvh);
        return bvh.render(scene, camera, options);
      }
    }

    return composer.render(scene, camera, options);
  }

  _syncMutableOptions(composer) {
    for (const key of [
      'layered',
      'renderToScreen',
      'manageRendererInfo',
      'foregroundLayer',
      'depthMode',
      'autoDiscover',
      'autoDiscoverBlockers',
      'autoOpaqueIntersections',
    ]) {
      if (key in this && key in composer) composer[key] = this[key];
      else if (key in this._options && key in composer) composer[key] = this._options[key];
    }
  }

  getMemoryReport() {
    return this._bvh?.getMemoryReport() ?? {
      triangles: 0,
      glassTriangles: 0,
      opaqueTriangles: 0,
      volumes: 0,
      geometryBytes: 0,
      bvhBytes: 0,
      estimatedGpuBytes: 0,
      totalBytes: 0,
    };
  }

  dispose() {
    this._analytic?.dispose();
    this._bvh?.dispose();
    this._analytic = null;
    this._bvh = null;
  }
}

export function supportsLayeredGlass(renderer) {
  return Boolean(renderer?.isWebGLRenderer && (renderer.capabilities?.isWebGL2 ?? true));
}

export function supportsLayeredGlassFloatTargets(renderer) {
  return supportsLayeredGlass(renderer)
    && Boolean(renderer.getContext()?.getExtension?.('EXT_color_buffer_float'));
}
