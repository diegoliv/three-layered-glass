import {
  BackSide,
  BasicDepthPacking,
  Color,
  DepthFormat,
  DepthTexture,
  FrontSide,
  GLSL3,
  HalfFloatType,
  LinearFilter,
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
  backNormalFragmentShader,
  backPositionFragmentShader,
  copyFragmentShader,
  fullscreenVertexShader,
  passVertexShader,
} from './shaders/passes.js';

const DEPTH_MODES = new Set(['none', 'opaque', 'front-surface']);
const _drawingBufferSize = new Vector2();
const _clearColor = new Color();
const _worldPositionA = new Vector3();
const _worldPositionB = new Vector3();
const _viewport = new Vector4();
const _scissor = new Vector4();

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

function distanceSquaredToCamera(object, camera) {
  object.getWorldPosition(_worldPositionA);
  camera.getWorldPosition(_worldPositionB);
  return _worldPositionA.distanceToSquared(_worldPositionB);
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
    data = false,
    colorType = UnsignedByteType,
    depthTexture = false,
    name,
  },
) {
  const target = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: data ? HalfFloatType : colorType,
    minFilter: data ? NearestFilter : LinearFilter,
    magFilter: data ? NearestFilter : LinearFilter,
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

function createPassMaterial(fragmentShader, side) {
  return new ShaderMaterial({
    name: side === BackSide
      ? 'LayeredGlassBackFacePass'
      : 'LayeredGlassPass',
    glslVersion: GLSL3,
    vertexShader: passVertexShader,
    fragmentShader,
    side,
    depthTest: true,
    depthWrite: true,
    blending: NoBlending,
    toneMapped: false,
  });
}

function createFullscreenMaterial(fragmentShader) {
  return new ShaderMaterial({
    name: 'LayeredGlassFullscreenCopy',
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

/**
 * Sort glass objects from back to front.
 *
 * Higher material priorities are rendered later. Objects sharing a priority
 * are sorted by world-space distance to the camera.
 */
export function sortGlassObjectsBackToFront(objects, camera, target = []) {
  target.length = 0;
  target.push(...objects);
  target.sort((a, b) => {
    const priorityA = a.material?.priority ?? 0;
    const priorityB = b.material?.priority ?? 0;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    return distanceSquaredToCamera(b, camera) - distanceSquaredToCamera(a, camera);
  });
  return target;
}

export function supportsLegacyLayeredGlass(renderer) {
  if (!renderer?.isWebGLRenderer) {
    return false;
  }

  const context = renderer.getContext();
  return Boolean(context?.getExtension?.('EXT_color_buffer_float'));
}

/**
 * Legacy multi-pass compositor that makes each LayeredGlassMaterial sample the glass
 * volumes already composed behind it.
 *
 * This class orchestrates an existing THREE.WebGLRenderer. It does not create
 * another WebGL context or replace the Three.js scene graph.
 */
export class LegacyLayeredGlassComposer {
  constructor(renderer, options = {}) {
    if (!renderer?.isWebGLRenderer) {
      throw new TypeError('LegacyLayeredGlassComposer requires a THREE.WebGLRenderer.');
    }

    if (!supportsLegacyLayeredGlass(renderer)) {
      throw new Error(
        'LegacyLayeredGlassComposer requires WebGL2 and EXT_color_buffer_float.',
      );
    }

    const privateLayer = options.privateLayer ?? 31;
    const foregroundPrivateLayer = options.foregroundPrivateLayer ?? 30;
    validateLayer(privateLayer, 'privateLayer');
    validateLayer(foregroundPrivateLayer, 'foregroundPrivateLayer');

    if (privateLayer === foregroundPrivateLayer) {
      throw new Error('privateLayer and foregroundPrivateLayer must be different.');
    }

    this.renderer = renderer;
    this.layered = options.layered ?? true;
    this.autoDiscover = options.autoDiscover ?? true;
    this.privateLayer = privateLayer;
    this.foregroundPrivateLayer = foregroundPrivateLayer;
    this.foregroundLayer = options.foregroundLayer ?? null;
    this.colorType = options.colorType ?? HalfFloatType;
    this.renderToScreen = options.renderToScreen ?? true;
    this.depthMode = options.depthMode ?? 'opaque';
    this.manageRendererInfo = options.manageRendererInfo ?? true;

    this._validateDepthMode(this.depthMode);

    this._registeredObjects = new Set();
    this._registeredForegroundObjects = new Set();
    this._glassObjects = [];
    this._sortedGlassObjects = [];
    this._foregroundObjects = [];
    this._foregroundObjectSet = new Set();
    this._visibilityState = new Map();
    this._temporaryObjectState = new Map();
    this._size = new Vector2(1, 1);
    this._outputTexture = null;
    this._outputRenderTarget = null;
    this._depthTexture = null;

    this._backPositionMaterial = createPassMaterial(
      backPositionFragmentShader,
      BackSide,
    );
    this._backNormalMaterial = createPassMaterial(
      backNormalFragmentShader,
      BackSide,
    );
    this._copyMaterial = createFullscreenMaterial(copyFragmentShader);
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
      this._copyMaterial,
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
        throw new TypeError('LegacyLayeredGlassComposer.add() accepts THREE.Mesh instances.');
      }
      this._registeredObjects.add(object);
    }
    return this;
  }

  remove(...objects) {
    for (const object of objects) {
      this._registeredObjects.delete(object);
    }
    return this;
  }

  clear() {
    this._registeredObjects.clear();
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
    this._compositeTargetA.setSize(nextWidth, nextHeight);
    this._compositeTargetB.setSize(nextWidth, nextHeight);
    this._backPositionTarget.setSize(nextWidth, nextHeight);
    this._backNormalTarget.setSize(nextWidth, nextHeight);
    this._combinedDepthTarget.setSize(nextWidth, nextHeight);
    return this;
  }

  _validateDepthMode(depthMode) {
    if (!DEPTH_MODES.has(depthMode)) {
      throw new Error(
        `Unknown depthMode "${depthMode}". Use "none", "opaque", or "front-surface".`,
      );
    }
  }

  _allocateTargets(width, height) {
    this._baseTarget = createTarget(width, height, {
      colorType: this.colorType,
      depthTexture: true,
      name: 'LayeredGlass.Base',
    });
    this._compositeTargetA = createTarget(width, height, {
      colorType: this.colorType,
      name: 'LayeredGlass.CompositeA',
    });
    this._compositeTargetB = createTarget(width, height, {
      colorType: this.colorType,
      name: 'LayeredGlass.CompositeB',
    });
    this._backPositionTarget = createTarget(width, height, {
      data: true,
      name: 'LayeredGlass.BackPosition',
    });
    this._backNormalTarget = createTarget(width, height, {
      data: true,
      name: 'LayeredGlass.BackNormal',
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
        ) {
          this._appendForegroundObject(object);
        }
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

  _renderFullscreen(texture, target, { clear = true, display = false } = {}) {
    const material = display ? this._displayMaterial : this._copyMaterial;
    this._fullscreenQuad.material = material;

    if (display) {
      const hadMap = Boolean(this._displayMaterial.map);
      this._displayMaterial.map = texture;
      if (!hadMap) this._displayMaterial.needsUpdate = true;
    } else {
      this._copyMaterial.uniforms.uTexture.value = texture;
    }

    this.renderer.setRenderTarget(target);

    if (clear) {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    }

    this.renderer.render(this._fullscreenScene, this._fullscreenCamera);
  }

  _renderObjectPass(scene, camera, object, target, material) {
    const previousOverrideMaterial = scene.overrideMaterial;

    try {
      this._withIsolatedObjects(
        [object],
        camera,
        this.privateLayer,
        () => {
          scene.overrideMaterial = material;
          this.renderer.setRenderTarget(target);
          this.renderer.setClearColor(0x000000, 0);
          this.renderer.clear(true, true, true);
          this.renderer.render(scene, camera);
        },
      );
    } finally {
      scene.overrideMaterial = previousOverrideMaterial;
    }
  }

  _renderGlassLayer(scene, camera, object, sourceTexture, destinationTarget) {
    this._renderObjectPass(
      scene,
      camera,
      object,
      this._backPositionTarget,
      this._backPositionMaterial,
    );
    this._renderObjectPass(
      scene,
      camera,
      object,
      this._backNormalTarget,
      this._backNormalMaterial,
    );

    this._renderFullscreen(sourceTexture, destinationTarget);

    const material = object.material;
    const sampledSource = this.layered
      ? sourceTexture
      : this._baseTarget.texture;

    material
      .setCamera(camera)
      .setSize(this._size.x, this._size.y)
      .setComposerTextures(
        sampledSource,
        this._backPositionTarget.texture,
        this._backNormalTarget.texture,
      );

    this._withIsolatedObjects(
      [object],
      camera,
      this.privateLayer,
      () => {
        this.renderer.setRenderTarget(destinationTarget);
        this.renderer.clearDepth();
        this.renderer.render(scene, camera);
      },
    );
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

  /**
   * Render a scene with layered refractive glass.
   *
   * @param {import('three').Scene} scene
   * @param {import('three').Camera} camera
   * @param {object} [options]
   * @param {import('three').Mesh[]} [options.glassObjects]
   * @param {import('three').Object3D[]} [options.foregroundObjects]
   * @param {import('three').WebGLRenderTarget|null} [options.outputTarget]
   * @param {boolean} [options.present]
   * @param {boolean} [options.toneMap]
   * @param {number} [options.width]
   * @param {number} [options.height]
   */
  render(scene, camera, options = {}) {
    const outputTarget = options.outputTarget ?? null;
    this._syncSize(outputTarget, options.width, options.height);

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const glassObjects = this._collectGlassObjects(scene, options.glassObjects);
    const foregroundObjects = this._collectForegroundObjects(
      scene,
      options.foregroundObjects,
    );
    sortGlassObjectsBackToFront(
      glassObjects,
      camera,
      this._sortedGlassObjects,
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
    this._saveAndHideObjects(this._sortedGlassObjects);
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
      scene.background = null;

      let readTexture = this._baseTarget.texture;
      let readTarget = this._baseTarget;
      let writeTarget = this._compositeTargetA;

      for (const object of this._sortedGlassObjects) {
        this._renderGlassLayer(
          scene,
          camera,
          object,
          readTexture,
          writeTarget,
        );
        readTexture = writeTarget.texture;
        readTarget = writeTarget;
        writeTarget = writeTarget === this._compositeTargetA
          ? this._compositeTargetB
          : this._compositeTargetA;
      }

      this._resolveDepthTexture(scene, camera, this._sortedGlassObjects);

      if (foregroundObjects.length > 0 && readTarget === this._baseTarget) {
        this._renderFullscreen(readTexture, this._compositeTargetA);
        readTarget = this._compositeTargetA;
        readTexture = readTarget.texture;
      }

      this._renderForeground(scene, camera, foregroundObjects, readTarget);

      this._outputTexture = readTexture;
      this._outputRenderTarget = readTarget;

      const shouldPresent = options.present ?? this.renderToScreen;
      if (shouldPresent) {
        const shouldToneMap = options.toneMap ?? outputTarget === null;
        renderer.toneMapping = shouldToneMap
          ? previousToneMapping
          : NoToneMapping;
        this._renderFullscreen(readTexture, outputTarget, {
          display: shouldToneMap,
        });
      }

      return readTexture;
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
    this._compositeTargetA.dispose();
    this._compositeTargetB.dispose();
    this._backPositionTarget.dispose();
    this._backNormalTarget.dispose();
    this._combinedDepthTarget.dispose();
    this._backPositionMaterial.dispose();
    this._backNormalMaterial.dispose();
    this._copyMaterial.dispose();
    this._displayMaterial.dispose();
    this._depthMaterial.dispose();
    this._fullscreenQuad.geometry.dispose();
    this.clear();
    this.clearForeground();
  }
}
