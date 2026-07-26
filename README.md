# three-layered-glass

Deterministic layered refraction for Three.js and React Three Fiber.

Version 0.4 adds a static triangle-BVH backend that traces the real triangles of `BufferGeometry` and GLB meshes. Visible opaque meshes participate automatically, so ordinary objects can occlude and appear behind refracted glass without blocker registration or analytic shape declarations.

## Install

```bash
npm install three-layered-glass three
```

The BVH backend uses [`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh), installed as a package dependency.

React Three Fiber is optional:

```bash
npm install three-layered-glass three react @react-three/fiber
```

## Requirements

- Three.js `WebGLRenderer`
- WebGL2
- Static `BufferGeometry` for the 0.4 BVH backend

Floating-point render targets improve HDR range but are not mandatory. The color compositor can fall back to unsigned-byte targets.

## Quick start

```js
import * as THREE from 'three';
import {
  LayeredGlassComposer,
  LayeredGlassMaterial,
} from 'three-layered-glass';

const renderer = new THREE.WebGLRenderer({ antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

const glass = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.28, 180, 32),
  new LayeredGlassMaterial({
    ior: 1.48,
    roughness: 0.05,
    attenuationColor: '#8bcfff',
    attenuationDistance: 1.15,
    reflectionStrength: 1.85,
    dispersion: 0.006,
  }),
);
scene.add(glass);

// Normal opaque Three.js objects are detected automatically.
const opaque = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 0.25),
  new THREE.MeshPhysicalMaterial({ color: '#ff8b74' }),
);
opaque.position.z = -2;
scene.add(opaque);

const glassComposer = new LayeredGlassComposer(renderer, {
  backend: 'auto',
  quality: 'medium',
  worker: true,
});

await glassComposer.prepare(scene, {
  onProgress(progress) {
    console.log(`BVH ${Math.round(progress * 100)}%`);
  },
});

renderer.setAnimationLoop(() => {
  glassComposer.render(scene, camera);
});
```

`LayeredGlassComposer` uses the existing `WebGLRenderer`; it does not create a second WebGL context.

## GLB and arbitrary static geometry

The BVH backend does not need `shape`, `radius`, `halfExtents`, or `center`. It uses the mesh triangles after applying their world transforms.

```js
const gltf = await gltfLoader.loadAsync('/product.glb');
scene.add(gltf.scene);

const glassMesh = gltf.scene.getObjectByName('Glass');
glassMesh.material = new LayeredGlassMaterial({
  ior: 1.5,
  roughness: 0.03,
  attenuationColor: '#d9f2ff',
  attenuationDistance: 2,
  dispersion: 0.004,
});

await glassComposer.prepare(scene);
```

Static boxes, bevelled meshes, bottles, lenses, sculptures, and other closed GLB meshes can share the same traversal backend.

## Automatic opaque intersections

Opaque meshes are opt-out, not opt-in. A visible `THREE.Mesh` is included when its material is non-transparent with effective opacity `1`.

No blocker API is required:

```js
scene.add(opaqueMesh);
await glassComposer.prepare(scene);
```

Exclude exceptional objects explicitly:

```js
glassComposer.setRayVisibility(helperMesh, 'ignore');
```

Or attach metadata before preparation:

```js
helperMesh.userData.layeredGlass = {
  rayVisibility: 'ignore',
};
```

Available overrides are:

```text
auto | opaque | glass | ignore
```

`addBlocker()` and the R3F `LayeredGlassBlocker` component remain as deprecated compatibility aliases.

## Material properties

```js
const material = new LayeredGlassMaterial({
  mode: 'volume',
  ior: 1.48,
  roughness: 0.05,
  attenuationColor: '#8bcfff',
  attenuationDistance: 1.15,
  refractionReach: 2.1,
  reflectionStrength: 1.85,
  dispersion: 0.006,
  bodyTintStrength: 1,
});
```

### Volume glass

```js
new LayeredGlassMaterial({ mode: 'volume' });
```

The geometry should be closed, manifold, and consistently wound. Entry and exit hits are discovered from the real triangles, and Beer-Lambert attenuation uses the distance traveled through the volume.

### Thin glass

```js
new LayeredGlassMaterial({
  mode: 'thin',
  thickness: 0.012,
});
```

Use thin mode for single-surface windows or GLB meshes that do not define a closed volume.

## Backends

```js
new LayeredGlassComposer(renderer, {
  backend: 'auto',
});
```

- `auto` — uses the analytic renderer as a temporary preparation fallback and switches to BVH when ready.
- `bvh` — uses static triangle traversal and automatic opaque intersections.
- `analytic` — the fast 0.3 primitive backend. It requires analytic proxies and explicit blockers for exact opaque interleaving.

Optional analytic proxies remain available as an explicit optimization:

```js
glassComposer.setIntersectionProxy(mesh, {
  shape: 'roundedBox',
  radius: 0.08,
});
```

The proxy is ignored by the BVH backend.

## Quality tiers

```js
const glassComposer = new LayeredGlassComposer(renderer, {
  quality: 'medium',
});
```

| Tier | Resolution | Spectral paths | Rough paths | Max traversals |
| --- | ---: | ---: | ---: | ---: |
| `low` | 0.5× | 1 | 1 | 4 |
| `medium` | 0.75× | 3 | 1 | 8 |
| `high` | 1× | 3 | 2 | 12 |

Override individual values:

```js
const glassComposer = new LayeredGlassComposer(renderer, {
  quality: 'medium',
  resolutionScale: 0.6,
  maxTraversals: 6,
  spectral: false,
  roughSamples: 1,
});
```

The heavy BVH resolver is preceded by a rasterized glass-coverage pass, so pixels outside visible glass silhouettes return before triangle traversal. The resolver may run below full resolution, but its result is composited over the full-resolution opaque scene; lowering the quality tier does not downscale ordinary non-glass rendering.

## Scene preparation and synchronization

### Static scene

```js
await glassComposer.prepare(scene, { worker: true });
```

The worker build is the recommended production path. While preparation runs, `backend: 'auto'` can display the analytic fallback where the geometry is representable.

### Geometry or transform changes

```js
glassMesh.position.x += 1;
glassMesh.updateMatrixWorld();

glassComposer.invalidateGeometry(glassMesh);
await glassComposer.prepare(scene);
```

Version 0.4 bakes world-space static geometry. Rigid transforms after preparation require a rebuild.

### Optical material changes

```js
glassMaterial.ior = 1.52;
glassMaterial.dispersion = 0.012;
glassComposer.invalidateMaterial(glassMesh);
```

Material-only changes refresh GPU metadata without rebuilding the BVH when triangle classification is unchanged. With `sceneSync: 'auto'`, optical changes are detected automatically.

For fully manual synchronization:

```js
const glassComposer = new LayeredGlassComposer(renderer, {
  sceneSync: 'manual',
});
```

## Memory diagnostics

```js
console.log(glassComposer.getMemoryReport());
// {
//   triangles,
//   glassTriangles,
//   opaqueTriangles,
//   volumes,
//   geometryBytes,
//   bvhBytes,
//   estimatedGpuBytes,
//   totalBytes,
// }
```

## React Three Fiber

```jsx
import {
  LayeredGlass,
  LayeredGlassComposer,
} from 'three-layered-glass/r3f';

function Experience() {
  return (
    <LayeredGlassComposer
      backend="bvh"
      quality="medium"
      worker
      renderPriority={1}
    >
      <LayeredGlass
        materialProps={{
          ior: 1.48,
          roughness: 0.05,
          attenuationColor: '#8bcfff',
          dispersion: 0.006,
        }}
      >
        <torusKnotGeometry args={[1, 0.28, 180, 32]} />
      </LayeredGlass>

      {/* Included automatically as opaque geometry. */}
      <mesh position={[0, 0, -2]}>
        <boxGeometry args={[2, 2, 0.25]} />
        <meshStandardMaterial color="#ff8b74" />
      </mesh>
    </LayeredGlassComposer>
  );
}
```

Available R3F exports:

- `LayeredGlassComposer`
- `LayeredGlassMaterial`
- `LayeredGlass`
- `useLayeredGlassComposer`
- `useLayeredGlassMaterial`
- `useLayeredGlassRayVisibility`
- `LayeredGlassEffectPass`
- deprecated blocker helpers

## EffectComposer

Use `LayeredGlassPass` instead of a normal `RenderPass`:

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LayeredGlassPass } from 'three-layered-glass';

const composer = new EffectComposer(renderer);
composer.addPass(new LayeredGlassPass(scene, camera, {
  backend: 'bvh',
  quality: 'medium',
}));
composer.addPass(new OutputPass());
```

## Current limits

Version 0.4 is the first static BVH release:

- Static regular `Mesh` objects are supported.
- `InstancedMesh`, `BatchedMesh`, continuously skinned geometry, and live morph deformation are excluded from the ray scene.
- World transforms and topology changes require BVH preparation again.
- Volume glass requires closed geometry with consistent winding; use thin mode for single surfaces.
- Opaque hit shading reuses the normal rasterized scene when the hit is visible from the camera and falls back to material color plus environment response otherwise.
- Transparent non-glass materials are ignored by automatic opaque discovery.
- Recursive reflected geometry is not traced; reflections use a deterministic environment response.
- `front-surface` depth currently exposes the opaque depth result in the BVH backend.

The next architecture stage is a two-level acceleration structure for cheap rigid-object transform updates.

## Legacy renderer

The 0.2 arbitrary-mesh ping-pong pipeline remains available for migration:

```js
import { LegacyLayeredGlassComposer } from 'three-layered-glass';
```

It uses back-position/back-normal buffers and retains global object-order limitations.

## Documentation

- [`docs/0.4.0-architecture.md`](./docs/0.4.0-architecture.md)
- [`docs/0.4.0-migration.md`](./docs/0.4.0-migration.md)
- [`docs/0.2-vs-0.3-analysis.md`](./docs/0.2-vs-0.3-analysis.md)

## License

MIT
