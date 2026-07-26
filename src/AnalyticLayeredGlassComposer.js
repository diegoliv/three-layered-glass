import {
  BasicDepthPacking,
  Color,
  DepthFormat,
  DepthTexture,
  FrontSide,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import {
  copyFragmentShader,
  fullscreenVertexShader,
} from './shaders/passes.js';
import {
  createVolumeResolverFragmentShader,
  volumeResolverVertexShader,
} from './shaders/volumeResolver.js';
import {
  isLayeredGlassBlocker,
  LAYERED_GLASS_VOLUME_KINDS,
  resolveLayeredGlassVolume,
} from './volumes.js';

const DEPTH_MODES = new Set(['none', 'opaque', 'front-surface']);
const _drawingBufferSize = new Vector2();
const _clearColor = new Color();
const _whiteColor = new Color(1, 1, 1);
const _viewport = new Vector4();
const _scissor = new Vector4();
const _cameraPosition = new Vector3();

function isRenderableObject(object) {
  return Boolean(
    object?.isMesh ||
    object?.isLine ||
    object?.isPoints ||
    object?.isSprite,
  );
}

function isLayeredGlassObject(object) {
  return Boolean(
    object?.isMesh &&
    object.visible &&
    object.material?.isLayeredGlassMaterial,
  );
}

function validateLayer(layer, label) {
  if (!Number.isInteger(layer) || layer < 0 || layer > 31) {
    throw new RangeError(`${label} must be an integer between 0 and 31.`);
  }
}

function createDepthTexture(width, height, name) {
  const texture = new DepthTexture(width, height, UnsignedIntType);
  texture.name = name;
  texture.format = DepthFormat;
  texture.type = UnsignedIntType;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createTarget(
  width,
  height,
  {
    colorType = UnsignedByteType,
    depthTexture = false,
    name,
  },
) {
  const target = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: colorType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  target.texture.name = name;
  target.texture.colorSpace = NoColorSpace;
  target.texture.generateMipmaps = false;

  if (depthTexture) {
    target.depthTexture = createDepthTexture(
      width,
      height,
      `${name}.Depth`,
    );
  }

  return target;
}

function createFullscreenMaterial(fragmentShader, name) {
  return new ShaderMaterial({
    name,
    glslVersion: GLSL3,
    vertexShader: fullscreenVertexShader,
    fragmentShader,
    uniforms: {
      uTexture: { value: null },
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
  });
}

function supportsFloatColorTargets(renderer) {
  return Boolean(
    renderer?.getContext?.()?.getExtension?.('EXT_color_buffer_float'),
  );
}

export function supportsLayeredGlass(renderer) {
  return Boolean(
    renderer?.isWebGLRenderer &&
    (renderer.capabilities?.isWebGL2 ?? true),
  );
}

export function supportsLayeredGlassFloatTargets(renderer) {
  return supportsLayeredGlass(renderer) && supportsFloatColorTargets(renderer);
}

/**
 * Per-pixel analytic volume compositor.
 *
 * Unlike the 0.2 multi-pass implementation, this class never assigns one
 * global draw order to a glass mesh. Every pixel finds the nearest registered
 * analytic volume, refracts through it, and continues from the new world-space
 * ray. Registered opaque blockers participate in the same intersection list.
 */
export class AnalyticLayeredGlassComposer {
  constructor(renderer, options = {}) {
    if (!renderer?.isWebGLRenderer) {
      throw new TypeError('LayeredGlassComposer requires a THREE.WebGLRenderer.');
    }

    if (!supportsLayeredGlass(renderer)) {
      throw new Error('LayeredGlassComposer requires WebGL2.');
    }

    const foregroundPrivateLayer = options.foregroundPrivateLayer ?? 30;
    validateLayer(foregroundPrivateLayer, 'foregroundPrivateLayer');

    this.renderer = renderer;
    this.layered = options.layered ?? true;
    this.autoDiscover = options.autoDiscover ?? true;
    this.autoDiscoverBlockers = options.autoDiscoverBlockers ?? true;
    this.foregroundPrivateLayer = foregroundPrivateLayer;
    this.foregroundLayer = options.foregroundLayer ?? null;
    this.renderToScreen = options.renderToScreen ?? true;
    this.depthMode = options.depthMode ?? 'opaque';
    this.manageRendererInfo = options.manageRendererInfo ?? true;
    this.maxVolumes = Math.max(1, Math.floor(options.maxVolumes ?? 12));
    this.maxTraversals = Math.max(
      1,
      Math.min(
        this.maxVolumes,
        Math.floor(options.maxTraversals ?? this.maxVolumes),
      ),
    );
    this.entrySteps = Math.max(2, Math.floor(options.entrySteps ?? 10));
    this.exitSteps = Math.max(2, Math.floor(options.exitSteps ?? 12));
    this.opaqueSteps = Math.max(2, Math.floor(options.opaqueSteps ?? 12));
    this.colorType = options.colorType ?? (
      supportsFloatColorTargets(renderer)
        ? HalfFloatType
        : UnsignedByteType
    );

    this._validateDepthMode(this.depthMode);
    this._validateUniformBudget();

    this._registeredObjects = new Set();
    this._registeredBlockers = new Map();
    this._registeredForegroundObjects = new Set();
    this._glassObjects = [];
    this._blockerEntries = [];
    this._foregroundObjects = [];
    this._foregroundObjectSet = new Set();
    this._visibilityState = new Map();
    this._temporaryObjectState = new Map();
    this._size = new Vector2(1, 1);
    this._outputTexture = null;
    this._outputRenderTarget = null;
    this._depthTexture = null;

    const matrixLength = this.maxVolumes * 16;
    const vectorLength = this.maxVolumes * 4;
    this._worldToLocal = new Float32Array(matrixLength);
    this._localToWorld = new Float32Array(matrixLength);
    this._volumeBounds = new Float32Array(vectorLength);
    this._volumeOpticalA = new Float32Array(vectorLength);
    this._volumeOpticalB = new Float32Array(vectorLength);
    this._volumeMeta = new Float32Array(vectorLength);

    this._resolverMaterial = new ShaderMaterial({
      name: 'LayeredGlassVolumeResolver',
      glslVersion: GLSL3,
      vertexShader: volumeResolverVertexShader,
      fragmentShader: createVolumeResolverFragmentShader({
        maxVolumes: this.maxVolumes,
        maxTraversals: this.maxTraversals,
        entrySteps: this.entrySteps,
        exitSteps: this.exitSteps,
        opaqueSteps: this.opaqueSteps,
      }),
      uniforms: {
        uBaseColor: { value: null },
        uBaseDepth: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uInverseProjection: { value: new Matrix4() },
        uCameraMatrixWorld: { value: new Matrix4() },
        uProjectionMatrix: { value: new Matrix4() },
        uViewMatrix: { value: new Matrix4() },
        uCameraPosition: { value: new Vector3() },
        uWorldToLocal: { value: this._worldToLocal },
        uLocalToWorld: { value: this._localToWorld },
        uVolumeBounds: { value: this._volumeBounds },
        uVolumeOpticalA: { value: this._volumeOpticalA },
        uVolumeOpticalB: { value: this._volumeOpticalB },
        uVolumeMeta: { value: this._volumeMeta },
        uVolumeCount: { value: 0 },
        uLayered: { value: this.layered ? 1 : 0 },
        uUseSpectral: { value: 1 },
        uMaxDispersion: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: NoBlending,
      toneMapped: false,
    });

    this._copyMaterial = createFullscreenMaterial(
      copyFragmentShader,
      'LayeredGlassFullscreenCopy',
    );
    this._displayMaterial = new MeshBasicMaterial({
      name: 'LayeredGlassDisplay',
      map: null,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: true,
    });
    this._depthMaterial = new MeshDepthMaterial({
      name: 'LayeredGlassCombinedDepth',
      side: FrontSide,
      depthPacking: BasicDepthPacking,
      depthTest: true,
      depthWrite: true,
      blending: NoBlending,
    });

    this._fullscreenScene = new Scene();
    this._fullscreenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fullscreenQuad = new Mesh(
      new PlaneGeometry(2, 2),
      this._resolverMaterial,
    );
    this._fullscreenQuad.frustumCulled = false;
    this._fullscreenScene.add(this._fullscreenQuad);

    this._allocateTargets(1, 1);
  }

  get outputTexture() {
    return this._outputTexture;
  }

  get outputRenderTarget() {
    return this._outputRenderTarget;
  }

  get depthTexture() {
    return this._depthTexture;
  }

  get opaqueDepthTexture() {
    return this._baseTarget.depthTexture;
  }

  get frontSurfaceDepthTexture() {
    return this._combinedDepthTarget.depthTexture;
  }

  get width() {
    return this._size.x;
  }

  get height() {
    return this._size.y;
  }

  add(...objects) {
    for (const object of objects) {
      if (!object?.isMesh) {
        throw new TypeError('LayeredGlassComposer.add() accepts THREE.Mesh instances.');
      }
      this._registeredObjects.add(object);
    }
    return this;
  }

  remove(...objects) {
    for (const object of objects) this._registeredObjects.delete(object);
    return this;
  }

  clear() {
    this._registeredObjects.clear();
    return this;
  }

  addBlocker(object, options = {}) {
    if (!object?.isMesh) {
      throw new TypeError('LayeredGlassComposer.addBlocker() requires a THREE.Mesh.');
    }
    this._registeredBlockers.set(object, { ...options });
    return this;
  }

  addBlockers(...objects) {
    for (const object of objects) this.addBlocker(object);
    return this;
  }

  addOpaque(object, options = {}) {
    return this.addBlocker(object, options);
  }

  removeBlocker(...objects) {
    for (const object of objects) this._registeredBlockers.delete(object);
    return this;
  }

  removeOpaque(...objects) {
    return this.removeBlocker(...objects);
  }

  clearBlockers() {
    this._registeredBlockers.clear();
    return this;
  }

  addForeground(...objects) {
    for (const object of objects) {
      if (!object?.isObject3D) {
        throw new TypeError(
          'LayeredGlassComposer.addForeground() accepts THREE.Object3D instances.',
        );
      }
      this._registeredForegroundObjects.add(object);
    }
    return this;
  }

  removeForeground(...objects) {
    for (const object of objects) {
      this._registeredForegroundObjects.delete(object);
    }
    return this;
  }

  clearForeground() {
    this._registeredForegroundObjects.clear();
    return this;
  }

  setSize(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));

    if (nextWidth === this._size.x && nextHeight === this._size.y) {
      return this;
    }

    this._size.set(nextWidth, nextHeight);
    this._baseTarget.setSize(nextWidth, nextHeight);
    this._resolveTarget.setSize(nextWidth, nextHeight);
    this._combinedDepthTarget.setSize(nextWidth, nextHeight);
    this._resolverMaterial.uniforms.uResolution.value.set(
      nextWidth,
      nextHeight,
    );
    return this;
  }

  _validateDepthMode(depthMode) {
    if (!DEPTH_MODES.has(depthMode)) {
      throw new Error(
        `Unknown depthMode "${depthMode}". Use "none", "opaque", or "front-surface".`,
      );
    }
  }

  _validateUniformBudget() {
    const context = this.renderer.getContext();
    const maximum = context?.getParameter?.(
      context.MAX_FRAGMENT_UNIFORM_VECTORS,
    );
    if (!maximum) return;

    const estimated = this.maxVolumes * 12 + 28;
    if (estimated > maximum) {
      throw new Error(
        `maxVolumes=${this.maxVolumes} is too high for this GPU. ` +
        `The resolver estimates ${estimated} fragment uniform vectors, but the GPU reports ${maximum}.`,
      );
    }
  }

  _allocateTargets(width, height) {
    this._baseTarget = createTarget(width, height, {
      colorType: this.colorType,
      depthTexture: true,
      name: 'LayeredGlass.Base',
    });
    this._resolveTarget = createTarget(width, height, {
      colorType: this.colorType,
      name: 'LayeredGlass.Resolve',
    });
    this._combinedDepthTarget = createTarget(width, height, {
      colorType: UnsignedByteType,
      depthTexture: true,
      name: 'LayeredGlass.FrontSurfaceDepth',
    });
  }

  _syncSize(outputTarget, width, height) {
    if (width != null && height != null) {
      this.setSize(width, height);
      return;
    }

    if (outputTarget?.isRenderTarget) {
      this.setSize(outputTarget.width, outputTarget.height);
      return;
    }

    this.renderer.getDrawingBufferSize(_drawingBufferSize);
    this.setSize(_drawingBufferSize.x, _drawingBufferSize.y);
  }

  _collectGlassObjects(scene, providedObjects) {
    this._glassObjects.length = 0;

    if (providedObjects) {
      for (const object of providedObjects) {
        if (isLayeredGlassObject(object)) this._glassObjects.push(object);
      }
      return this._glassObjects;
    }

    if (this._registeredObjects.size > 0) {
      for (const object of this._registeredObjects) {
        if (isLayeredGlassObject(object)) this._glassObjects.push(object);
      }
      return this._glassObjects;
    }

    if (this.autoDiscover) {
      scene.traverse((object) => {
        if (isLayeredGlassObject(object)) this._glassObjects.push(object);
      });
    }

    return this._glassObjects;
  }

  _collectBlockers(scene, providedBlockers) {
    this._blockerEntries.length = 0;
    const seen = new Set();

    const append = (object, options = {}) => {
      if (!object?.isMesh || !object.visible || seen.has(object)) return;
      if (object.material?.isLayeredGlassMaterial) return;
      seen.add(object);
      this._blockerEntries.push({ object, options });
    };

    if (providedBlockers) {
      for (const entry of providedBlockers) {
        if (entry?.object?.isMesh) {
          append(entry.object, entry.options ?? entry);
        } else {
          append(entry, entry?.userData?.layeredGlassBlocker ?? {});
        }
      }
      return this._blockerEntries;
    }

    for (const [object, options] of this._registeredBlockers) {
      append(object, options);
    }

    if (this.autoDiscoverBlockers) {
      scene.traverse((object) => {
        if (isLayeredGlassBlocker(object)) {
          append(object, object.userData.layeredGlassBlocker);
        }
      });
    }

    return this._blockerEntries;
  }

  _appendForegroundObject(object) {
    if (!isRenderableObject(object)) return;
    if (object.material?.isLayeredGlassMaterial) return;
    if (this._foregroundObjectSet.has(object)) return;
    this._foregroundObjectSet.add(object);
    this._foregroundObjects.push(object);
  }

  _collectForegroundObjects(scene, providedObjects) {
    this._foregroundObjects.length = 0;
    this._foregroundObjectSet.clear();

    const addObjectAndDescendants = (root) => {
      root.traverse((object) => this._appendForegroundObject(object));
    };

    if (providedObjects) {
      for (const object of providedObjects) {
        if (object?.isObject3D) addObjectAndDescendants(object);
      }
    } else {
      for (const object of this._registeredForegroundObjects) {
        addObjectAndDescendants(object);
      }
    }

    if (this.foregroundLayer != null) {
      validateLayer(this.foregroundLayer, 'foregroundLayer');
      scene.traverse((object) => {
        if (
          isRenderableObject(object) &&
          object.layers.isEnabled(this.foregroundLayer)
        ) this._appendForegroundObject(object);
      });
    }

    return this._foregroundObjects;
  }

  _saveAndHideObjects(objects) {
    for (const object of objects) {
      if (!this._visibilityState.has(object)) {
        this._visibilityState.set(object, object.visible);
      }
      object.visible = false;
    }
  }

  _restoreHiddenObjects() {
    for (const [object, visible] of this._visibilityState) {
      object.visible = visible;
    }
    this._visibilityState.clear();
  }

  _withIsolatedObjects(objects, camera, layer, callback) {
    const previousCameraLayerMask = camera.layers.mask;
    this._temporaryObjectState.clear();

    for (const object of objects) {
      this._temporaryObjectState.set(object, {
        visible: object.visible,
        layerMask: object.layers.mask,
      });
      object.visible = true;
      object.layers.set(layer);
    }

    camera.layers.set(layer);

    try {
      return callback();
    } finally {
      camera.layers.mask = previousCameraLayerMask;
      for (const [object, state] of this._temporaryObjectState) {
        object.visible = state.visible;
        object.layers.mask = state.layerMask;
      }
      this._temporaryObjectState.clear();
    }
  }

  _withVisibleObjects(objects, callback) {
    this._temporaryObjectState.clear();

    for (const object of objects) {
      this._temporaryObjectState.set(object, {
        visible: object.visible,
        layerMask: object.layers.mask,
      });
      object.visible = true;
    }

    try {
      return callback();
    } finally {
      for (const [object, state] of this._temporaryObjectState) {
        object.visible = state.visible;
        object.layers.mask = state.layerMask;
      }
      this._temporaryObjectState.clear();
    }
  }

  _renderFullscreen(material, target, { clear = true } = {}) {
    this._fullscreenQuad.material = material;
    this.renderer.setRenderTarget(target);

    if (clear) {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    }

    this.renderer.render(this._fullscreenScene, this._fullscreenCamera);
  }

  _renderForeground(scene, camera, objects, target) {
    if (objects.length === 0) return;

    this._withIsolatedObjects(
      objects,
      camera,
      this.foregroundPrivateLayer,
      () => {
        this.renderer.setRenderTarget(target);
        this.renderer.clearDepth();
        this.renderer.render(scene, camera);
      },
    );
  }

  _renderCombinedDepth(scene, camera, glassObjects) {
    const previousOverrideMaterial = scene.overrideMaterial;

    try {
      this._withVisibleObjects(glassObjects, () => {
        scene.overrideMaterial = this._depthMaterial;
        this.renderer.setRenderTarget(this._combinedDepthTarget);
        this.renderer.setClearColor(0xffffff, 1);
        this.renderer.clear(true, true, true);
        this.renderer.render(scene, camera);
      });
    } finally {
      scene.overrideMaterial = previousOverrideMaterial;
    }

    this._depthTexture = this._combinedDepthTarget.depthTexture;
  }

  _resolveDepthTexture(scene, camera, glassObjects) {
    this._validateDepthMode(this.depthMode);

    if (this.depthMode === 'none') {
      this._depthTexture = null;
      return;
    }

    if (this.depthMode === 'opaque') {
      this._depthTexture = this._baseTarget.depthTexture;
      return;
    }

    this._renderCombinedDepth(scene, camera, glassObjects);
  }

  _writeMatrix(array, index, matrix) {
    matrix.toArray(array, index * 16);
  }

  _writeVector4(array, index, x, y, z, w) {
    const offset = index * 4;
    array[offset] = x;
    array[offset + 1] = y;
    array[offset + 2] = z;
    array[offset + 3] = w;
  }

  _uploadVolumes(camera, glassObjects, blockerEntries) {
    let volumeIndex = 0;
    let maximumDispersion = 0;
    let maximumRoughness = 0;

    const append = (object, kind, options = {}) => {
      if (volumeIndex >= this.maxVolumes) {
        throw new Error(
          `The scene contains more than maxVolumes=${this.maxVolumes} analytic volumes. ` +
          'Increase maxVolumes when creating LayeredGlassComposer or register fewer blockers.',
        );
      }

      const resolved = resolveLayeredGlassVolume(object, kind, options);
      const material = object.material;
      const isGlass = kind === LAYERED_GLASS_VOLUME_KINDS.GLASS;
      const ior = isGlass ? material.ior : 1;
      const roughness = isGlass ? material.roughness : 0;
      const attenuationDistance = isGlass
        ? material.attenuationDistance
        : 1;
      const reflectionStrength = isGlass
        ? material.reflectionStrength
        : 0;
      const attenuationColor = isGlass
        ? material.attenuationColor
        : _whiteColor;
      const dispersion = isGlass ? material.dispersion : 0;
      const refractionReach = isGlass ? material.refractionReach : 0;
      const bodyTintStrength = isGlass
        ? (material.bodyTintStrength ?? 1)
        : 0;

      this._writeMatrix(
        this._worldToLocal,
        volumeIndex,
        resolved.worldToLocal,
      );
      this._writeMatrix(
        this._localToWorld,
        volumeIndex,
        resolved.localToWorld,
      );
      this._writeVector4(
        this._volumeBounds,
        volumeIndex,
        resolved.halfExtents.x,
        resolved.halfExtents.y,
        resolved.halfExtents.z,
        resolved.radius,
      );
      this._writeVector4(
        this._volumeOpticalA,
        volumeIndex,
        ior,
        roughness,
        attenuationDistance,
        reflectionStrength,
      );
      this._writeVector4(
        this._volumeOpticalB,
        volumeIndex,
        attenuationColor.r,
        attenuationColor.g,
        attenuationColor.b,
        dispersion,
      );
      this._writeVector4(
        this._volumeMeta,
        volumeIndex,
        kind,
        resolved.shapeCode,
        refractionReach,
        bodyTintStrength,
      );

      maximumDispersion = Math.max(maximumDispersion, dispersion);
      maximumRoughness = Math.max(maximumRoughness, roughness);
      volumeIndex += 1;
    };

    for (const object of glassObjects) {
      append(object, LAYERED_GLASS_VOLUME_KINDS.GLASS);
    }
    for (const { object, options } of blockerEntries) {
      append(object, LAYERED_GLASS_VOLUME_KINDS.BLOCKER, options);
    }

    for (let index = volumeIndex; index < this.maxVolumes; index += 1) {
      this._writeVector4(this._volumeMeta, index, 0, 0, 0, 0);
    }

    camera.updateMatrixWorld(true);
    const uniforms = this._resolverMaterial.uniforms;
    uniforms.uVolumeCount.value = volumeIndex;
    uniforms.uLayered.value = this.layered ? 1 : 0;
    uniforms.uUseSpectral.value = (
      maximumDispersion >= 0.0005 || maximumRoughness >= 0.001
    ) ? 1 : 0;
    uniforms.uMaxDispersion.value = maximumDispersion;
    uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.uCameraMatrixWorld.value.copy(camera.matrixWorld);
    uniforms.uProjectionMatrix.value.copy(camera.projectionMatrix);
    uniforms.uViewMatrix.value.copy(camera.matrixWorldInverse);
    camera.getWorldPosition(_cameraPosition);
    uniforms.uCameraPosition.value.copy(_cameraPosition);
  }

  /**
   * Render the normal Three.js scene, then resolve every registered analytic
   * glass volume and opaque blocker in one per-pixel traversal pass.
   */
  render(scene, camera, options = {}) {
    const outputTarget = options.outputTarget ?? null;
    this._syncSize(outputTarget, options.width, options.height);

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const glassObjects = this._collectGlassObjects(
      scene,
      options.glassObjects,
    );
    const blockerEntries = this._collectBlockers(
      scene,
      options.blockerObjects ?? options.blockers,
    );
    const foregroundObjects = this._collectForegroundObjects(
      scene,
      options.foregroundObjects,
    );

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousToneMapping = renderer.toneMapping;
    const previousXrEnabled = renderer.xr.enabled;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousClearAlpha = renderer.getClearAlpha();
    const previousScissorTest = renderer.getScissorTest();
    const previousInfoAutoReset = renderer.info.autoReset;
    renderer.getClearColor(_clearColor);
    renderer.getViewport(_viewport);
    renderer.getScissor(_scissor);

    const previousBackground = scene.background;
    const previousOverrideMaterial = scene.overrideMaterial;
    const previousCameraLayerMask = camera.layers.mask;

    if (this.manageRendererInfo && previousInfoAutoReset) {
      renderer.info.reset();
      renderer.info.autoReset = false;
    }
    renderer.autoClear = false;
    renderer.toneMapping = NoToneMapping;
    renderer.xr.enabled = false;

    this._visibilityState.clear();
    this._saveAndHideObjects(glassObjects);
    this._saveAndHideObjects(foregroundObjects);

    try {
      camera.layers.mask = previousCameraLayerMask;
      scene.overrideMaterial = null;
      scene.background = previousBackground;

      renderer.setRenderTarget(this._baseTarget);
      renderer.setClearColor(_clearColor, previousClearAlpha);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      renderer.shadowMap.autoUpdate = false;
      this._uploadVolumes(camera, glassObjects, blockerEntries);
      this._resolverMaterial.uniforms.uBaseColor.value = this._baseTarget.texture;
      this._resolverMaterial.uniforms.uBaseDepth.value = this._baseTarget.depthTexture;

      scene.background = null;
      this._renderFullscreen(this._resolverMaterial, this._resolveTarget);
      this._resolveDepthTexture(scene, camera, glassObjects);
      this._renderForeground(
        scene,
        camera,
        foregroundObjects,
        this._resolveTarget,
      );

      this._outputTexture = this._resolveTarget.texture;
      this._outputRenderTarget = this._resolveTarget;

      const shouldPresent = options.present ?? this.renderToScreen;
      if (shouldPresent) {
        const shouldToneMap = options.toneMap ?? outputTarget === null;
        renderer.toneMapping = shouldToneMap
          ? previousToneMapping
          : NoToneMapping;

        if (shouldToneMap) {
          const hadMap = Boolean(this._displayMaterial.map);
          this._displayMaterial.map = this._resolveTarget.texture;
          if (!hadMap) this._displayMaterial.needsUpdate = true;
          this._renderFullscreen(this._displayMaterial, outputTarget);
        } else {
          this._copyMaterial.uniforms.uTexture.value = this._resolveTarget.texture;
          this._renderFullscreen(this._copyMaterial, outputTarget);
        }
      }

      return this._resolveTarget.texture;
    } finally {
      this._restoreHiddenObjects();
      camera.layers.mask = previousCameraLayerMask;
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverrideMaterial;

      renderer.autoClear = previousAutoClear;
      renderer.toneMapping = previousToneMapping;
      renderer.xr.enabled = previousXrEnabled;
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      if (this.manageRendererInfo) {
        renderer.info.autoReset = previousInfoAutoReset;
      }
      renderer.setClearColor(_clearColor, previousClearAlpha);
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(_viewport);
      renderer.setScissor(_scissor);
      renderer.setScissorTest(previousScissorTest);
    }
  }

  dispose() {
    this._baseTarget.dispose();
    this._resolveTarget.dispose();
    this._combinedDepthTarget.dispose();
    this._resolverMaterial.dispose();
    this._copyMaterial.dispose();
    this._displayMaterial.dispose();
    this._depthMaterial.dispose();
    this._fullscreenQuad.geometry.dispose();
    this.clear();
    this.clearBlockers();
    this.clearForeground();
  }
}
