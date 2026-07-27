import React, {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  Canvas,
  useFrame,
  useLoader,
  useThree,
} from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { supportsLayeredGlass } from '../src/index.js';
import {
  LayeredGlassMaterial,
  useLayeredGlass,
} from '../src/r3f/index.js';
import { LayeredGlassComposer } from '../src/r3f/advanced.js';
import { getOrbitDistanceLimits } from './cameraLimits.js';
import {
  MODEL_GAP,
  createModelQueueLayout,
  createPanelQueueSpacing,
} from './modelLayout.js';

const MAX_PANELS = 12;
const PANEL_WIDTH = 2.55;
const PANEL_HEIGHT = 3.85;
const PANEL_RADIUS = 0.11;
const PANEL_Y = PANEL_HEIGHT * 0.5 + 0.035;
const MODEL_SIZE = 2.65;
const OBJECTS_URL = new URL('../static/objects.glb', import.meta.url).href;
const DRACO_DECODER_URL =
  'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const HDR_URLS = [
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr',
];
const OPAQUE_PALETTE = [
  0xf4f1eb,
  0xff8b74,
  0xf5c05c,
  0x62c8bd,
  0x8aa9ff,
  0xb58be0,
  0xe7a4d6,
];
const IS_MOBILE = window.matchMedia('(max-width: 680px)').matches;
const MAXIMUM_PIXEL_RATIO = IS_MOBILE ? 1 : 1.25;
const MOBILE_ADAPTIVE_QUALITY = {
  minScale: 0.45,
  maxScale: 0.62,
  initialScale: 0.55,
  targetFrameTime: 1000 / 30,
  adjustmentInterval: 1200,
  stepDown: 0.05,
  stepUp: 0.025,
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO_DECODER_URL);

function configureGltfLoader(loader) {
  loader.setDRACOLoader(dracoLoader);
}

function createStudioBackdropTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d');

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#c8d0dc');
  gradient.addColorStop(0.42, '#929dab');
  gradient.addColorStop(0.72, '#46505d');
  gradient.addColorStop(1, '#171b22');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const leftSoftbox = context.createRadialGradient(
    210,
    250,
    10,
    210,
    250,
    330,
  );
  leftSoftbox.addColorStop(0, 'rgba(255,255,255,0.82)');
  leftSoftbox.addColorStop(0.45, 'rgba(210,230,255,0.22)');
  leftSoftbox.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = leftSoftbox;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createFloorTexture(maxAnisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  context.fillStyle = '#d6d8da';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(64,72,82,0.18)';
  context.lineWidth = 2;

  for (let position = 0; position <= canvas.width; position += 64) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(canvas.width, position);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.anisotropy = Math.min(4, maxAnisotropy);
  return texture;
}

function makeRandomKinds(count) {
  const kinds = Array.from(
    { length: count },
    () => (Math.random() < 0.66 ? 'glass' : 'opaque'),
  );
  const glassCount = kinds.filter((kind) => kind === 'glass').length;

  if (glassCount < Math.min(2, count)) {
    kinds[0] = 'glass';
    if (count > 1) kinds[count - 1] = 'glass';
  }
  if (count >= 3 && kinds.every((kind) => kind === 'glass')) {
    kinds[Math.floor(count * 0.5)] = 'opaque';
  }
  return kinds;
}

function extractModelShapes(scene) {
  const shapes = [];

  scene.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox.clone();
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = MODEL_SIZE / Math.max(size.x, size.y, size.z);

    shapes.push({
      name: object.name || `Object ${shapes.length + 1}`,
      geometry,
      horizontalRadius: Math.hypot(size.x, size.z) * scale * 0.5,
      scale,
      offset: [
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      ],
    });
  });

  return shapes;
}

function QueueMaterial({ kind, index, material }) {
  if (kind === 'glass') {
    return (
      <LayeredGlassMaterial
        ior={material.ior}
        roughness={material.roughness}
        attenuationDistance={material.attenuationDistance}
        attenuationColor={material.glassColor}
        refractionReach={material.refractionReach}
        reflectionStrength={material.reflectionStrength}
        dispersion={material.dispersion}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      color={OPAQUE_PALETTE[index % OPAQUE_PALETTE.length]}
      roughness={0.31}
      metalness={0}
      clearcoat={0.35}
      clearcoatRoughness={0.2}
      envMapIntensity={1.05}
    />
  );
}

function PanelQueue({
  count,
  gap,
  kinds,
  material,
  thickness,
}) {
  const geometry = useMemo(() => {
    const radius = Math.min(PANEL_RADIUS, thickness * 0.42);
    return new RoundedBoxGeometry(
      PANEL_WIDTH,
      PANEL_HEIGHT,
      thickness,
      IS_MOBILE ? 4 : 6,
      radius,
    );
  }, [thickness]);
  const spacing = createPanelQueueSpacing(count, gap);
  const center = (count - 1) * 0.5;

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      {kinds.map((kind, index) => {
        const offset = index - center;
        const normalized = count > 1 ? index / (count - 1) - 0.5 : 0;
        const alternatingTilt = index % 2 === 0 ? -0.035 : 0.035;

        return (
          <group
            key={`${index}-${kind}`}
            position={[
              offset * spacing.x,
              PANEL_Y,
              -offset * spacing.z,
            ]}
            rotation={[0, -0.20 + normalized * 0.38 + alternatingTilt, 0]}
          >
            <mesh
              geometry={geometry}
              castShadow={kind === 'opaque'}
              receiveShadow={kind === 'opaque'}
            >
              <QueueMaterial kind={kind} index={index} material={material} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ModelQueue({
  count,
  kinds,
  material,
  objectScale,
  queueGap,
  shapes,
}) {
  const layout = createModelQueueLayout(
    shapes,
    count,
    objectScale,
    queueGap,
  );

  return (
    <group dispose={null}>
      {shapes.slice(0, count).map((shape, index) => {
        const kind = kinds[index];
        const normalized = count > 1 ? index / (count - 1) - 0.5 : 0;
        const alternatingTilt = index % 2 === 0 ? -0.10 : 0.10;

        return (
          <group
            key={`${shape.name}-${kind}`}
            name={`queued-${shape.name}`}
            position={layout.placements[index]}
            rotation={[0, -0.28 + normalized * 0.48 + alternatingTilt, 0]}
          >
            <mesh
              geometry={shape.geometry}
              position={[
                shape.offset[0] * objectScale,
                0.035 + shape.offset[1] * objectScale,
                shape.offset[2] * objectScale,
              ]}
              scale={shape.scale * objectScale}
              castShadow={kind === 'opaque'}
              receiveShadow={kind === 'opaque'}
            >
              <QueueMaterial kind={kind} index={index} material={material} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function CameraRig({
  source,
  count,
  objectScale,
  queueGap,
  shapes,
}) {
  const { camera, gl, size } = useThree();
  const controls = useMemo(
    () => new OrbitControls(camera, gl.domElement),
    [camera, gl],
  );

  useEffect(() => {
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.48;
    return () => controls.dispose();
  }, [controls]);

  useLayoutEffect(() => {
    const isPanelSource = source === 'panels';
    const panelSpacing = isPanelSource
      ? createPanelQueueSpacing(count, queueGap)
      : null;
    const modelLayout = isPanelSource
      ? null
      : createModelQueueLayout(shapes, count, objectScale, queueGap);
    const depthSpan = modelLayout?.depthSpan ??
      Math.max(0, count - 1) * (panelSpacing?.z ?? 0);
    const lateralSpan = modelLayout?.lateralSpan ??
      Math.max(0, count - 1) * (panelSpacing?.x ?? 0);
    const sceneHeight = isPanelSource
      ? PANEL_HEIGHT
      : MODEL_SIZE * objectScale;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const reservedWidth = IS_MOBILE ? 0 : 390;
    const usableWidth = Math.max(
      size.width - reservedWidth,
      size.width * 0.55,
    );
    const effectiveAspect = usableWidth / Math.max(1, size.height);
    const horizontalFov = 2 * Math.atan(
      Math.tan(verticalFov * 0.5) * effectiveAspect,
    );
    const queueWidth = isPanelSource
      ? lateralSpan + PANEL_WIDTH
      : lateralSpan;
    const heightDistance =
      (sceneHeight * (IS_MOBILE ? 0.82 : 0.74)) /
      Math.tan(verticalFov * 0.5);
    const widthDistance = (queueWidth * 0.58) / Math.tan(horizontalFov * 0.5);
    const distance =
      Math.max(heightDistance, widthDistance) + depthSpan * 0.14 + 0.8;
    const targetX = !isPanelSource && !IS_MOBILE
      ? queueWidth * reservedWidth / (2 * usableWidth)
      : 0;
    const target = new THREE.Vector3(
      targetX,
      sceneHeight * (isPanelSource ? 0.50 : 0.44),
      -depthSpan * 0.04,
    );
    const direction = new THREE.Vector3(0.54, 0.14, 1).normalize();

    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    const orbitLimits = getOrbitDistanceLimits(distance, IS_MOBILE);
    controls.minDistance = orbitLimits.minDistance;
    controls.maxDistance = orbitLimits.maxDistance;
    camera.near = Math.max(0.035, distance * 0.0035);
    camera.far = Math.max(90, distance * 6);
    camera.updateProjectionMatrix();
    controls.update();
  }, [
    camera,
    controls,
    count,
    objectScale,
    queueGap,
    shapes,
    size.height,
    size.width,
    source,
  ]);

  useFrame(() => controls.update(), -1);
  return null;
}

function StudioEnvironment({ onEnvironmentState }) {
  const { gl, scene } = useThree();
  const backdropTexture = useMemo(createStudioBackdropTexture, []);
  const floorTexture = useMemo(
    () => createFloorTexture(gl.capabilities.getMaxAnisotropy()),
    [gl],
  );

  useEffect(() => {
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    scene.background = backdropTexture;
    scene.fog = new THREE.Fog(0x6d7682, 22, 54);

    return () => {
      scene.background = previousBackground;
      scene.fog = previousFog;
      backdropTexture.dispose();
    };
  }, [backdropTexture, scene]);

  useEffect(() => () => floorTexture.dispose(), [floorTexture]);

  useEffect(() => {
    let active = true;
    let environmentTexture = null;
    const loader = new HDRLoader();
    onEnvironmentState({ ready: false, label: 'HDR loading' });

    async function loadEnvironment() {
      for (const url of HDR_URLS) {
        try {
          const texture = await loader.loadAsync(url);
          if (!active) {
            texture.dispose();
            return;
          }
          texture.mapping = THREE.EquirectangularReflectionMapping;
          environmentTexture = texture;
          scene.environment = texture;
          onEnvironmentState({
            ready: true,
            label: url.includes('polyhaven')
              ? 'Poly Haven HDR global light'
              : 'HDR fallback global light',
          });
          return;
        } catch (error) {
          console.warn(`Unable to load HDR environment from ${url}.`, error);
        }
      }

      if (active) {
        onEnvironmentState({
          ready: true,
          label: 'Procedural studio light',
        });
      }
    }

    loadEnvironment();

    return () => {
      active = false;
      if (scene.environment === environmentTexture) scene.environment = null;
      environmentTexture?.dispose();
    };
  }, [onEnvironmentState, scene]);

  return (
    <>
      <hemisphereLight args={[0xffffff, 0x87919f, 0.48]} />
      <directionalLight
        color={0xffffff}
        intensity={1.55}
        position={[-5, 8, 8]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={0.5}
        shadow-camera-far={32}
        shadow-bias={-0.0002}
      />
      <directionalLight
        color={0x9dbaff}
        intensity={0.42}
        position={[7, 3, 2]}
      />
      <mesh rotation={[-Math.PI * 0.5, 0, 0]} receiveShadow>
        <planeGeometry args={[48, 48]} />
        <meshPhysicalMaterial
          color={0xffffff}
          map={floorTexture}
          roughness={0.27}
          metalness={0.08}
          clearcoat={0.34}
          clearcoatRoughness={0.28}
          envMapIntensity={1.05}
        />
      </mesh>
    </>
  );
}

function ComposerStatus({ onStatus }) {
  const { composer, error, progress, status } = useLayeredGlass();

  useEffect(() => {
    if (status === 'error') {
      onStatus({ status, label: 'BVH failed', error });
      return;
    }

    if (status === 'ready') {
      const report = composer.getMemoryReport();
      onStatus({
        status,
        label: `BVH | ${report.triangles.toLocaleString()} tris`,
        error: null,
      });
      return;
    }

    onStatus({
      status,
      label: `Building BVH | ${Math.round(progress * 100)}%`,
      error: null,
    });
  }, [composer, error, onStatus, progress, status]);

  return null;
}

function PerformanceProbe({ onFps }) {
  const frames = useRef(0);
  const sampleStart = useRef(0);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime * 1000;
    frames.current += 1;
    if (sampleStart.current === 0) sampleStart.current = time;
    if (time - sampleStart.current < 700) return;

    onFps(Math.round(
      (frames.current * 1000) / (time - sampleStart.current),
    ));
    frames.current = 0;
    sampleStart.current = time;
  });

  return null;
}

function Experience({
  count,
  kinds,
  layered,
  material,
  onBvhStatus,
  onEnvironmentState,
  onFps,
  onModelReady,
  objectScale,
  panelThickness,
  queueGap,
  source,
}) {
  const gltf = useLoader(
    GLTFLoader,
    OBJECTS_URL,
    configureGltfLoader,
  );
  const shapes = useMemo(() => extractModelShapes(gltf.scene), [gltf.scene]);
  const composerKey = [
    source,
    count,
    objectScale,
    queueGap,
    kinds.join('-'),
  ].join(':');

  useEffect(() => {
    onModelReady(shapes.length);
  }, [onModelReady, shapes.length]);

  return (
    <>
      <StudioEnvironment onEnvironmentState={onEnvironmentState} />
      <CameraRig
        source={source}
        count={count}
        objectScale={objectScale}
        queueGap={queueGap}
        shapes={shapes}
      />

      <LayeredGlassComposer
        key={composerKey}
        backend="bvh"
        layered={layered}
        quality={IS_MOBILE ? 'low' : 'medium'}
        adaptive={IS_MOBILE ? MOBILE_ADAPTIVE_QUALITY : false}
      >
        <ComposerStatus onStatus={onBvhStatus} />
        {source === 'panels' ? (
          <PanelQueue
            count={count}
            gap={queueGap}
            thickness={panelThickness}
            kinds={kinds}
            material={material}
          />
        ) : (
          <ModelQueue
            count={count}
            kinds={kinds}
            material={material}
            objectScale={objectScale}
            queueGap={queueGap}
            shapes={shapes}
          />
        )}
        <PerformanceProbe onFps={onFps} />
      </LayeredGlassComposer>
    </>
  );
}

function RangeControl({
  digits = 2,
  label,
  max,
  min,
  onChange,
  step,
  value,
}) {
  return (
    <label className="control">
      <span className="control-header">
        <span>{label}</span>
        <output>{Number(value).toFixed(digits)}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ControlPanel({
  assignment,
  availableObjectCount,
  count,
  environment,
  expanded,
  fps,
  glassCount,
  layered,
  material,
  objectCount,
  objectScale,
  opaqueCount,
  panelCount,
  panelThickness,
  queueGap,
  source,
  status,
  onAssignment,
  onExpanded,
  onLayered,
  onMaterial,
  onObjectCount,
  onObjectScale,
  onPanelCount,
  onPanelThickness,
  onQueueGap,
  onSource,
}) {
  const isPanelSource = source === 'panels';
  const sourceLabel = isPanelSource ? 'panels' : 'GLB objects';

  return (
    <aside
      className="control-panel"
      data-expanded={expanded}
      aria-label="Demo controls"
    >
      <button
        className="panel-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls="panel-content"
        onClick={() => onExpanded(!expanded)}
      >
        <span className="panel-heading">
          <span className="eyebrow">React Three Fiber | GLB workflow</span>
          <span className="panel-title">Layered glass queue</span>
        </span>
        <span className="panel-toggle-side">
          <span className="compact-status">
            {count} {sourceLabel}
          </span>
          <span className="chevron" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <path d="M3 6l5 5 5-5" />
            </svg>
          </span>
        </span>
      </button>

      <div className="panel-content" id="panel-content">
        <p className="description">
          Declarative R3F meshes and loaded GLB geometry share one automatic
          triangle BVH, including ordinary opaque materials.
        </p>

        <div className="segmented" role="group" aria-label="Compositing mode">
          <button
            type="button"
            aria-pressed={layered}
            onClick={() => onLayered(true)}
          >
            Layered
          </button>
          <button
            type="button"
            aria-pressed={!layered}
            onClick={() => onLayered(false)}
          >
            Naive source
          </button>
        </div>

        <section className="control-section" aria-labelledby="geometry-title">
          <h2 id="geometry-title">Geometry source</h2>

          <div
            className="material-actions source-actions"
            role="group"
            aria-label="Geometry source"
          >
            <button
              type="button"
              aria-pressed={isPanelSource}
              onClick={() => onSource('panels')}
            >
              Panels
            </button>
            <button
              type="button"
              aria-pressed={!isPanelSource}
              onClick={() => onSource('models')}
            >
              GLB objects
            </button>
          </div>

          <label className="control">
            <span className="control-header">
              <span>{isPanelSource ? 'Panel count' : 'Object count'}</span>
              <output>{count}</output>
            </span>
            <input
              type="range"
              aria-label={isPanelSource ? 'Panel count' : 'Object count'}
              min="2"
              max={isPanelSource ? MAX_PANELS : availableObjectCount}
              value={isPanelSource ? panelCount : objectCount}
              step="1"
              onChange={(event) => {
                const nextCount = Number(event.target.value);
                if (isPanelSource) onPanelCount(nextCount);
                else onObjectCount(nextCount);
              }}
            />
          </label>

          <RangeControl
            label="Queue gap"
            min={0.05}
            max={1.5}
            step={0.01}
            value={queueGap}
            onChange={onQueueGap}
          />

          {isPanelSource ? (
            <RangeControl
              label="Panel thickness"
              min={0.06}
              max={0.7}
              step={0.01}
              value={panelThickness}
              onChange={onPanelThickness}
            />
          ) : (
            <RangeControl
              label="Object scale"
              min={0.55}
              max={1.2}
              step={0.05}
              value={objectScale}
              onChange={onObjectScale}
            />
          )}

          <label className="color-control">
            <span>
              <span className="color-label">Glass color</span>
              <output>{material.glassColor.toUpperCase()}</output>
            </span>
            <input
              type="color"
              value={material.glassColor}
              aria-label="Glass color"
              onChange={(event) => onMaterial(
                'glassColor',
                event.target.value,
              )}
            />
          </label>

          <div
            className="material-actions"
            role="group"
            aria-label="Material assignment"
          >
            <button
              type="button"
              aria-pressed={assignment === 'glass'}
              onClick={() => onAssignment('glass')}
            >
              All glass
            </button>
            <button
              type="button"
              aria-pressed={assignment === 'random'}
              onClick={() => onAssignment('random')}
            >
              Randomize mix
            </button>
          </div>
        </section>

        <section className="control-section" aria-labelledby="glass-title">
          <h2 id="glass-title">Glass shader</h2>

          <RangeControl
            label="Index of refraction"
            min={1.01}
            max={2}
            step={0.01}
            value={material.ior}
            onChange={(value) => onMaterial('ior', value)}
          />
          <RangeControl
            label="Rough transmission"
            min={0}
            max={1}
            step={0.01}
            value={material.roughness}
            onChange={(value) => onMaterial('roughness', value)}
          />
          <RangeControl
            label="Attenuation distance"
            min={0.10}
            max={4}
            step={0.05}
            value={material.attenuationDistance}
            onChange={(value) => onMaterial('attenuationDistance', value)}
          />
          <RangeControl
            label="Refraction reach"
            min={0.25}
            max={5}
            step={0.05}
            value={material.refractionReach}
            onChange={(value) => onMaterial('refractionReach', value)}
          />
          <RangeControl
            label="Reflection strength"
            min={0}
            max={3}
            step={0.05}
            value={material.reflectionStrength}
            onChange={(value) => onMaterial('reflectionStrength', value)}
          />
          <RangeControl
            digits={3}
            label="Dispersion"
            min={0}
            max={0.035}
            step={0.001}
            value={material.dispersion}
            onChange={(value) => onMaterial('dispersion', value)}
          />
        </section>

        <div className="meta" aria-live="polite">
          <span className="badge">{fps == null ? '-- FPS' : `${fps} FPS`}</span>
          <span className="badge">{glassCount} glass</span>
          <span className="badge">{opaqueCount} opaque</span>
          <span className="badge">
            {isPanelSource
              ? 'Procedural panels'
              : `${count} / ${availableObjectCount} GLB`}
          </span>
          <span className="badge">{environment.label}</span>
          <span
            className={`badge ${
              status.status === 'ready' ? 'is-ready' : ''
            } ${status.status === 'error' ? 'is-fallback' : ''}`}
          >
            {status.label}
          </span>
        </div>
      </div>
    </aside>
  );
}

class DemoErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

function App() {
  const [assignment, setAssignment] = useState('glass');
  const [availableObjectCount, setAvailableObjectCount] = useState(7);
  const [bvhStatus, setBvhStatus] = useState({
    status: 'preparing',
    label: 'Waiting for GLB',
    error: null,
  });
  const [environment, setEnvironment] = useState({
    ready: false,
    label: 'HDR loading',
  });
  const [expanded, setExpanded] = useState(!IS_MOBILE);
  const [fatalError, setFatalError] = useState(null);
  const [fps, setFps] = useState(null);
  const [layered, setLayered] = useState(true);
  const [material, setMaterial] = useState({
    glassColor: '#8bcfff',
    ior: 1.48,
    roughness: 0.05,
    attenuationDistance: 1.15,
    refractionReach: 2.10,
    reflectionStrength: 1.85,
    dispersion: 0.006,
  });
  const [modelReady, setModelReady] = useState(false);
  const [objectCount, setObjectCount] = useState(7);
  const [objectScale, setObjectScale] = useState(0.8);
  const [panelCount, setPanelCount] = useState(5);
  const [panelThickness, setPanelThickness] = useState(0.36);
  const [queueGap, setQueueGap] = useState(MODEL_GAP);
  const [randomSeed, setRandomSeed] = useState(0);
  const [source, setSource] = useState('panels');
  const count = source === 'panels' ? panelCount : objectCount;
  const kinds = useMemo(
    () => (
      assignment === 'glass'
        ? Array.from({ length: count }, () => 'glass')
        : makeRandomKinds(count)
    ),
    [assignment, count, randomSeed, source],
  );
  const glassCount = kinds.filter((kind) => kind === 'glass').length;

  const handleAssignment = useCallback((nextAssignment) => {
    setAssignment(nextAssignment);
    if (nextAssignment === 'random') {
      setRandomSeed((seed) => seed + 1);
    }
  }, []);

  const handleMaterial = useCallback((property, value) => {
    setMaterial((current) => ({ ...current, [property]: value }));
  }, []);

  const handleModelReady = useCallback((shapeCount) => {
    setAvailableObjectCount(shapeCount);
    setObjectCount((current) => Math.min(current, shapeCount));
    setModelReady(true);
  }, []);

  const handleCanvasCreated = useCallback(({ gl }) => {
    if (!supportsLayeredGlass(gl)) {
      setFatalError(new Error(
        'WebGL2 is required for the layered glass BVH demo.',
      ));
      return;
    }

    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.debug.onShaderError = (
      context,
      program,
      vertexShader,
      fragmentShader,
    ) => {
      const log = [
        context.getShaderInfoLog(vertexShader),
        context.getShaderInfoLog(fragmentShader),
        context.getProgramInfoLog(program),
      ].filter(Boolean).join('\n');
      if (log) setFatalError(new Error(log));
    };
  }, []);

  const loadingLabel = !modelReady
    ? 'Loading GLB object library'
    : !environment.ready
      ? 'Loading HDR environment'
      : bvhStatus.status === 'preparing'
        ? bvhStatus.label
        : null;
  const error = fatalError ?? bvhStatus.error;

  return (
    <>
      <div className="canvas-shell">
        <DemoErrorBoundary onError={setFatalError}>
          <Canvas
            camera={{
              fov: 34,
              near: 0.05,
              far: 100,
              position: [5, 2, 9],
            }}
            dpr={[1, MAXIMUM_PIXEL_RATIO]}
            gl={{
              antialias: false,
              alpha: false,
              depth: true,
              powerPreference: 'high-performance',
            }}
            onCreated={handleCanvasCreated}
          >
            <Suspense fallback={null}>
              <Experience
                count={count}
                kinds={kinds}
                layered={layered}
                material={material}
                onBvhStatus={setBvhStatus}
                onEnvironmentState={setEnvironment}
                onFps={setFps}
                onModelReady={handleModelReady}
                objectScale={objectScale}
                panelThickness={panelThickness}
                queueGap={queueGap}
                source={source}
              />
            </Suspense>
          </Canvas>
        </DemoErrorBoundary>
      </div>

      <ControlPanel
        assignment={assignment}
        availableObjectCount={availableObjectCount}
        count={count}
        environment={environment}
        expanded={expanded}
        fps={fps}
        glassCount={glassCount}
        layered={layered}
        material={material}
        objectCount={objectCount}
        objectScale={objectScale}
        opaqueCount={count - glassCount}
        panelCount={panelCount}
        panelThickness={panelThickness}
        queueGap={queueGap}
        source={source}
        status={bvhStatus}
        onAssignment={handleAssignment}
        onExpanded={setExpanded}
        onLayered={setLayered}
        onMaterial={handleMaterial}
        onObjectCount={setObjectCount}
        onObjectScale={setObjectScale}
        onPanelCount={setPanelCount}
        onPanelThickness={setPanelThickness}
        onQueueGap={setQueueGap}
        onSource={setSource}
      />

      <div
        className={`loading-indicator ${loadingLabel ? '' : 'is-hidden'}`}
        aria-live="polite"
      >
        <span className="loading-dot" />
        <span>{loadingLabel ?? 'Ready'}</span>
      </div>

      <div className="hint">
        Drag to orbit | Pinch or wheel to zoom | Switch between panels and GLB
        objects
      </div>

      <div className={`error ${error ? 'is-visible' : ''}`} role="alert">
        <div>
          <h1>Unable to initialize the demo</h1>
          <p>{error?.message}</p>
        </div>
      </div>
    </>
  );
}

createRoot(document.querySelector('#app')).render(<App />);
