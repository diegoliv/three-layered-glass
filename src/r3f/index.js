import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  applyProps,
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  LayeredGlassComposer as CoreLayeredGlassComposer,
  LayeredGlassMaterial as CoreLayeredGlassMaterial,
  LayeredGlassPass as CoreLayeredGlassPass,
} from '../index.js';

const LayeredGlassContext = createContext(null);

function assignComposerOptions(composer, props) {
  composer.layered = props.layered ?? true;
  composer.autoDiscover = props.autoDiscover ?? true;
  composer.autoDiscoverBlockers = props.autoDiscoverBlockers ?? true;
  composer.foregroundLayer = props.foregroundLayer ?? null;
  composer.renderToScreen = props.renderToScreen ?? true;
  composer.depthMode = props.depthMode ?? 'opaque';
  composer.manageRendererInfo = props.manageRendererInfo ?? true;
  composer.autoOpaqueIntersections = props.autoOpaqueIntersections ?? true;
}

/**
 * Owns the R3F render step. The default `auto` backend prepares a static
 * triangle BVH and includes visible opaque meshes automatically.
 */
export function LayeredGlassComposer({
  children,
  enabled = true,
  renderPriority = 1,
  scene: sceneOverride,
  camera: cameraOverride,
  outputTarget = null,
  present,
  toneMap,
  glassObjects,
  blockerObjects,
  blockers,
  foregroundObjects,
  onCreated,
  onReady,
  onProgress,
  backend = 'auto',
  quality = 'medium',
  worker = true,
  sceneSync = 'auto',
  sceneSyncInterval,
  autoOpaqueIntersections = true,
  resolutionScale,
  coverageScale,
  coverageSamples,
  spectral,
  roughSamples,
  maxMedia = 8,
  layered = true,
  autoDiscover = true,
  autoDiscoverBlockers = true,
  foregroundPrivateLayer = 30,
  foregroundLayer = null,
  colorType,
  renderToScreen = true,
  depthMode = 'opaque',
  manageRendererInfo = true,
  maxVolumes = 12,
  maxTraversals,
  entrySteps = 10,
  exitSteps = 12,
  opaqueSteps = 12,
}) {
  const renderer = useThree((state) => state.gl);
  const defaultScene = useThree((state) => state.scene);
  const qualityKey = typeof quality === 'string'
    ? quality
    : JSON.stringify(quality);

  const composer = useMemo(
    () => new CoreLayeredGlassComposer(renderer, {
      backend,
      quality,
      worker,
      sceneSync,
      sceneSyncInterval,
      autoOpaqueIntersections,
      resolutionScale,
      coverageScale,
      coverageSamples,
      spectral,
      roughSamples,
      maxMedia,
      layered,
      autoDiscover,
      autoDiscoverBlockers,
      foregroundPrivateLayer,
      foregroundLayer,
      colorType,
      renderToScreen,
      depthMode,
      manageRendererInfo,
      maxVolumes,
      maxTraversals,
      entrySteps,
      exitSteps,
      opaqueSteps,
    }),
    [
      renderer,
      backend,
      qualityKey,
      worker,
      sceneSync,
      sceneSyncInterval,
      autoOpaqueIntersections,
      spectral,
      roughSamples,
      maxMedia,
      foregroundPrivateLayer,
      colorType,
      maxVolumes,
      maxTraversals,
      entrySteps,
      exitSteps,
      opaqueSteps,
    ],
  );

  useEffect(() => {
    assignComposerOptions(composer, {
      layered,
      autoDiscover,
      autoDiscoverBlockers,
      foregroundLayer,
      renderToScreen,
      depthMode,
      manageRendererInfo,
      autoOpaqueIntersections,
    });
  }, [
    composer,
    layered,
    autoDiscover,
    autoDiscoverBlockers,
    foregroundLayer,
    renderToScreen,
    depthMode,
    manageRendererInfo,
    autoOpaqueIntersections,
  ]);

  useEffect(() => {
    if (resolutionScale != null) composer.setResolutionScale(resolutionScale);
    if (coverageScale != null) composer.setCoverageScale(coverageScale);
    if (coverageSamples != null) composer.setCoverageSamples(coverageSamples);
  }, [composer, resolutionScale, coverageScale, coverageSamples]);

  useEffect(() => {
    onCreated?.(composer);
  }, [composer, onCreated]);

  useEffect(() => {
    if (backend === 'analytic') return undefined;
    let cancelled = false;
    const scene = sceneOverride ?? defaultScene;
    composer.prepare(scene, { worker, onProgress })
      .then(() => {
        if (!cancelled) onReady?.(composer);
      })
      .catch((error) => {
        if (!cancelled) console.error('LayeredGlass R3F prepare failed.', error);
      });
    return () => { cancelled = true; };
  }, [
    composer,
    backend,
    worker,
    onProgress,
    onReady,
    sceneOverride,
    defaultScene,
  ]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((state) => {
    const scene = sceneOverride ?? state.scene;
    const camera = cameraOverride ?? state.camera;

    if (!enabled) {
      state.gl.render(scene, camera);
      return;
    }

    composer.render(scene, camera, {
      glassObjects,
      blockerObjects: blockerObjects ?? blockers,
      foregroundObjects,
      outputTarget,
      present,
      toneMap,
    });
  }, renderPriority);

  return createElement(
    LayeredGlassContext.Provider,
    { value: composer },
    children,
  );
}

export function useLayeredGlassComposer() {
  const composer = useContext(LayeredGlassContext);
  if (!composer) {
    throw new Error(
      'useLayeredGlassComposer() must be used inside <LayeredGlassComposer>.',
    );
  }
  return composer;
}

/** Declarative wrapper around the core LayeredGlassMaterial class. */
export const LayeredGlassMaterial = forwardRef(
  function LayeredGlassMaterial(
    {
      attach = 'material',
      dispose = true,
      children: _children,
      ...materialProps
    },
    forwardedRef,
  ) {
    const material = useMemo(
      () => new CoreLayeredGlassMaterial(materialProps),
      [],
    );

    useImperativeHandle(forwardedRef, () => material, [material]);

    useLayoutEffect(() => {
      applyProps(material, materialProps);
    }, [material, materialProps]);

    const disposeRef = useRef(dispose);
    useEffect(() => {
      disposeRef.current = dispose;
    }, [dispose]);

    useEffect(
      () => () => {
        if (disposeRef.current) material.dispose();
      },
      [material],
    );

    return createElement('primitive', {
      object: material,
      attach,
    });
  },
);

/**
 * Convenience mesh that installs LayeredGlassMaterial and registers itself
 * even when the parent composer has autoDiscover disabled.
 */
export const LayeredGlass = forwardRef(
  function LayeredGlass(
    {
      children,
      materialProps = {},
      ...meshProps
    },
    forwardedRef,
  ) {
    const composer = useContext(LayeredGlassContext);
    const meshRef = useRef(null);
    useImperativeHandle(forwardedRef, () => meshRef.current, []);

    useLayoutEffect(() => {
      if (!composer || !meshRef.current) return undefined;
      composer.add(meshRef.current);
      return () => composer.remove(meshRef.current);
    }, [composer]);

    return createElement(
      'mesh',
      { ...meshProps, ref: meshRef },
      children,
      createElement(LayeredGlassMaterial, materialProps),
    );
  },
);

/**
 * @deprecated Opaque meshes are included automatically by the BVH backend.
 * This wrapper remains as an explicit ray-visibility override.
 */
export const LayeredGlassBlocker = forwardRef(
  function LayeredGlassBlocker(
    {
      children,
      shape = 'auto',
      radius = 0,
      halfExtents = null,
      center = null,
      ...meshProps
    },
    forwardedRef,
  ) {
    const composer = useLayeredGlassComposer();
    const meshRef = useRef(null);
    useImperativeHandle(forwardedRef, () => meshRef.current, []);

    useLayoutEffect(() => {
      const mesh = meshRef.current;
      if (!mesh) return undefined;
      composer.addBlocker(mesh, {
        shape,
        radius,
        halfExtents,
        center,
      });
      return () => composer.removeBlocker(mesh);
    }, [composer, shape, radius, halfExtents, center]);

    return createElement(
      'mesh',
      { ...meshProps, ref: meshRef },
      children,
    );
  },
);

export function useLayeredGlassMaterial(parameters = {}) {
  const material = useMemo(
    () => new CoreLayeredGlassMaterial(parameters),
    [],
  );

  useLayoutEffect(() => {
    applyProps(material, parameters);
  }, [material, parameters]);

  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** @deprecated Opaque meshes are automatic in the BVH backend. */
export function useLayeredGlassBlocker(objectRef, options = {}) {
  const composer = useLayeredGlassComposer();

  useLayoutEffect(() => {
    const object = objectRef?.current ?? objectRef;
    if (!object) return undefined;
    composer.addBlocker(object, options);
    return () => composer.removeBlocker(object);
  }, [composer, objectRef, options]);
}

/** Applies an explicit ray-scene visibility override, usually `ignore`. */
export function useLayeredGlassRayVisibility(objectRef, visibility = 'ignore') {
  const composer = useLayeredGlassComposer();

  useLayoutEffect(() => {
    const object = objectRef?.current ?? objectRef;
    if (!object) return undefined;
    composer.setRayVisibility(object, visibility);
    return () => composer.setRayVisibility(object, 'auto');
  }, [composer, objectRef, visibility]);
}

/** Registers LayeredGlassPass in an existing Three.js EffectComposer. */
export const LayeredGlassEffectPass = forwardRef(
  function LayeredGlassEffectPass(
    {
      composer,
      index = 0,
      renderPriority = null,
      enabled = true,
      scene: sceneOverride,
      camera: cameraOverride,
      onCreated,
      ...passOptions
    },
    forwardedRef,
  ) {
    const defaultScene = useThree((state) => state.scene);
    const defaultCamera = useThree((state) => state.camera);
    const scene = sceneOverride ?? defaultScene;
    const camera = cameraOverride ?? defaultCamera;

    const pass = useMemo(
      () => new CoreLayeredGlassPass(scene, camera, passOptions),
      [
        passOptions.backend,
        typeof passOptions.quality === 'string'
          ? passOptions.quality
          : JSON.stringify(passOptions.quality),
        passOptions.worker,
        passOptions.sceneSync,
        passOptions.sceneSyncInterval,
        passOptions.autoOpaqueIntersections,
        passOptions.spectral,
        passOptions.roughSamples,
        passOptions.maxMedia,
        passOptions.foregroundPrivateLayer,
        passOptions.colorType,
        passOptions.manageRendererInfo,
        passOptions.maxVolumes,
        passOptions.maxTraversals,
        passOptions.entrySteps,
        passOptions.exitSteps,
        passOptions.opaqueSteps,
      ],
    );

    useImperativeHandle(forwardedRef, () => pass, [pass]);

    useEffect(() => {
      pass.scene = scene;
      pass.camera = camera;
      pass.enabled = enabled;
      pass.layered = passOptions.layered ?? true;
      pass.autoDiscover = passOptions.autoDiscover ?? true;
      pass.autoDiscoverBlockers = passOptions.autoDiscoverBlockers ?? true;
      pass.foregroundLayer = passOptions.foregroundLayer ?? null;
      pass.depthMode = passOptions.depthMode ?? 'opaque';
      if (passOptions.resolutionScale != null) {
        pass.setResolutionScale(passOptions.resolutionScale);
      }
      if (passOptions.coverageScale != null) {
        pass.setCoverageScale(passOptions.coverageScale);
      }
      if (passOptions.coverageSamples != null) {
        pass.setCoverageSamples(passOptions.coverageSamples);
      }
      pass.glassObjects = passOptions.glassObjects ?? null;
      pass.blockerObjects = passOptions.blockerObjects
        ?? passOptions.blockers
        ?? null;
      pass.foregroundObjects = passOptions.foregroundObjects ?? null;
    }, [pass, scene, camera, enabled, passOptions]);

    useEffect(() => {
      const safeIndex = Math.max(0, Math.min(index, composer.passes.length));
      composer.insertPass(pass, safeIndex);
      return () => composer.removePass(pass);
    }, [composer, pass, index]);

    useEffect(() => {
      onCreated?.(pass);
    }, [pass, onCreated]);

    useEffect(() => () => pass.dispose(), [pass]);

    useFrame((_, delta) => {
      if (renderPriority != null && enabled) {
        composer.render(delta);
      }
    }, renderPriority ?? 0);

    return null;
  },
);
