import { Pass } from 'three/addons/postprocessing/Pass.js';
import { LayeredGlassComposer } from './LayeredGlassComposer.js';

/**
 * EffectComposer pass backed by LayeredGlassComposer. The default `auto`
 * backend prepares a static triangle BVH and replaces a normal RenderPass for
 * scenes containing LayeredGlassMaterial.
 */
export class LayeredGlassPass extends Pass {
  constructor(scene, camera, options = {}) {
    super();

    this.scene = scene;
    this.camera = camera;
    this.backend = options.backend ?? 'auto';
    this.quality = options.quality ?? 'medium';
    this.worker = options.worker ?? true;
    this.sceneSync = options.sceneSync ?? 'auto';
    this.autoOpaqueIntersections = options.autoOpaqueIntersections ?? true;
    this.resolutionScale = options.resolutionScale;
    this.spectral = options.spectral;
    this.roughSamples = options.roughSamples;
    this.maxMedia = options.maxMedia;
    this.layered = options.layered ?? true;
    this.autoDiscover = options.autoDiscover ?? true;
    this.autoDiscoverBlockers = options.autoDiscoverBlockers ?? true;
    this.foregroundPrivateLayer = options.foregroundPrivateLayer ?? 30;
    this.foregroundLayer = options.foregroundLayer ?? null;
    this.colorType = options.colorType;
    this.depthMode = options.depthMode ?? 'opaque';
    this.manageRendererInfo = options.manageRendererInfo ?? false;
    this.maxVolumes = options.maxVolumes ?? 12;
    this.maxTraversals = options.maxTraversals;
    this.entrySteps = options.entrySteps ?? 10;
    this.exitSteps = options.exitSteps ?? 12;
    this.opaqueSteps = options.opaqueSteps ?? 12;
    this.glassObjects = options.glassObjects ?? null;
    this.blockerObjects = options.blockerObjects ?? options.blockers ?? null;
    this.foregroundObjects = options.foregroundObjects ?? null;

    this.needsSwap = true;
    this.clear = true;

    this._composer = null;
    this._renderer = null;
    this._width = 1;
    this._height = 1;
  }

  get composer() {
    return this._composer;
  }

  get outputTexture() {
    return this._composer?.outputTexture ?? null;
  }

  get depthTexture() {
    return this._composer?.depthTexture ?? null;
  }

  _getComposer(renderer) {
    if (this._composer && this._renderer === renderer) {
      return this._composer;
    }

    this._composer?.dispose();
    this._renderer = renderer;
    this._composer = new LayeredGlassComposer(renderer, {
      backend: this.backend,
      quality: this.quality,
      worker: this.worker,
      sceneSync: this.sceneSync,
      autoOpaqueIntersections: this.autoOpaqueIntersections,
      resolutionScale: this.resolutionScale,
      spectral: this.spectral,
      roughSamples: this.roughSamples,
      maxMedia: this.maxMedia,
      layered: this.layered,
      autoDiscover: this.autoDiscover,
      autoDiscoverBlockers: this.autoDiscoverBlockers,
      foregroundPrivateLayer: this.foregroundPrivateLayer,
      foregroundLayer: this.foregroundLayer,
      colorType: this.colorType,
      depthMode: this.depthMode,
      manageRendererInfo: this.manageRendererInfo,
      maxVolumes: this.maxVolumes,
      maxTraversals: this.maxTraversals,
      entrySteps: this.entrySteps,
      exitSteps: this.exitSteps,
      opaqueSteps: this.opaqueSteps,
      renderToScreen: false,
    });
    this._composer.setSize(this._width, this._height);
    return this._composer;
  }

  prepare(options = {}) {
    if (!this._renderer) {
      throw new Error(
        'LayeredGlassPass.prepare() requires the pass to have rendered once, ' +
        'or use pass.composer.prepare() after the composer is created.',
      );
    }
    return this._getComposer(this._renderer).prepare(this.scene, options);
  }

  render(renderer, writeBuffer) {
    const composer = this._getComposer(renderer);
    composer.layered = this.layered;
    composer.autoDiscover = this.autoDiscover;
    composer.autoDiscoverBlockers = this.autoDiscoverBlockers;
    composer.foregroundLayer = this.foregroundLayer;
    composer.depthMode = this.depthMode;

    composer.render(this.scene, this.camera, {
      glassObjects: this.glassObjects ?? undefined,
      blockerObjects: this.blockerObjects ?? undefined,
      foregroundObjects: this.foregroundObjects ?? undefined,
      outputTarget: this.renderToScreen ? null : writeBuffer,
      present: true,
      toneMap: this.renderToScreen,
      width: this.renderToScreen ? undefined : writeBuffer.width,
      height: this.renderToScreen ? undefined : writeBuffer.height,
    });
  }

  setSize(width, height) {
    this._width = Math.max(1, Math.floor(width));
    this._height = Math.max(1, Math.floor(height));
    this._composer?.setSize(this._width, this._height);
  }

  dispose() {
    this._composer?.dispose();
    this._composer = null;
    this._renderer = null;
  }
}
