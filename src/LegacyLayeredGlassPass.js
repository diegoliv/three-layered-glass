import { Pass } from 'three/addons/postprocessing/Pass.js';
import { LegacyLayeredGlassComposer } from './LegacyLayeredGlassComposer.js';

/**
 * EffectComposer pass that replaces the normal RenderPass for a scene using
 * LayeredGlassMaterial.
 *
 * Add this pass before color-only post-processing effects. Keep an OutputPass
 * last when another pass follows this one.
 */
export class LegacyLayeredGlassPass extends Pass {
  constructor(scene, camera, options = {}) {
    super();

    this.scene = scene;
    this.camera = camera;
    this.layered = options.layered ?? true;
    this.autoDiscover = options.autoDiscover ?? true;
    this.privateLayer = options.privateLayer ?? 31;
    this.foregroundPrivateLayer = options.foregroundPrivateLayer ?? 30;
    this.foregroundLayer = options.foregroundLayer ?? null;
    this.colorType = options.colorType;
    this.depthMode = options.depthMode ?? 'opaque';
    this.manageRendererInfo = options.manageRendererInfo ?? false;
    this.glassObjects = options.glassObjects ?? null;
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
    this._composer = new LegacyLayeredGlassComposer(renderer, {
      layered: this.layered,
      autoDiscover: this.autoDiscover,
      privateLayer: this.privateLayer,
      foregroundPrivateLayer: this.foregroundPrivateLayer,
      foregroundLayer: this.foregroundLayer,
      colorType: this.colorType,
      depthMode: this.depthMode,
      manageRendererInfo: this.manageRendererInfo,
      renderToScreen: false,
    });
    this._composer.setSize(this._width, this._height);
    return this._composer;
  }

  render(renderer, writeBuffer) {
    const composer = this._getComposer(renderer);
    composer.layered = this.layered;
    composer.autoDiscover = this.autoDiscover;
    composer.foregroundLayer = this.foregroundLayer;
    composer.depthMode = this.depthMode;

    composer.render(this.scene, this.camera, {
      glassObjects: this.glassObjects ?? undefined,
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
