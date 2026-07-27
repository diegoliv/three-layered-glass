# three-layered-glass

Layer-aware glass for Three.js and React Three Fiber. It traces the real triangles of static `BufferGeometry` and GLB meshes, so multiple glass volumes and opaque objects refract in the correct order.

- Real mesh silhouettes; no box or sphere proxy is required.
- Opaque meshes participate automatically.
- One shared compositor for every glass object.
- Quality presets and optional adaptive transmission resolution.
- First-class Three.js, R3F, and `EffectComposer` APIs.

## Install

Three.js:

```bash
npm install three-layered-glass three
```

React Three Fiber:

```bash
npm install three-layered-glass three react @react-three/fiber
```

Use R3F 8 with React 18, or R3F 9 with React 19.

## React Three Fiber

Add one composer to the scene and use `LayeredGlassMaterial` like any other material:

```jsx
import { Canvas } from '@react-three/fiber';
import {
  LayeredGlassComposer,
  LayeredGlassMaterial,
} from 'three-layered-glass/r3f';

function Experience() {
  return (
    <>
      <LayeredGlassComposer />

      <mesh>
        <torusKnotGeometry args={[1, 0.28, 180, 32]} />
        <LayeredGlassMaterial
          roughness={0.05}
          attenuationColor="#8bcfff"
        />
      </mesh>

      {/* Ordinary opaque meshes are included automatically. */}
      <mesh position={[0, 0, -2]}>
        <boxGeometry args={[2, 2, 0.25]} />
        <meshStandardMaterial color="#ff8b74" />
      </mesh>
    </>
  );
}

export default function App() {
  return (
    <Canvas camera={{ position: [0, 0, 7], fov: 40 }}>
      <Experience />
    </Canvas>
  );
}
```

That is the complete default setup. The compositor discovers the glass and opaque meshes, prepares the static ray scene in a worker when available, owns the R3F render step, and disposes its GPU resources when unmounted.

For devices with different performance budgets, enable adaptive transmission resolution:

```jsx
<LayeredGlassComposer adaptive />
```

Use `quality="low"`, `"medium"` (default), or `"high"` when you want a fixed tier.

### Loading state

Wrap consumers in the composer only when they need its status:

```jsx
import {
  LayeredGlassComposer,
  useLayeredGlass,
} from 'three-layered-glass/r3f';

function GlassStatus() {
  const { status, progress, error } = useLayeredGlass();
  // status: 'preparing' | 'ready' | 'error'
  return null;
}

function Experience() {
  return (
    <LayeredGlassComposer onError={(error) => reportError(error)}>
      <GlassStatus />
      <Scene />
    </LayeredGlassComposer>
  );
}
```

See [the complete R3F guide](./docs/r3f.md) for GLB materials, exclusions, custom scenes, post-processing, and advanced controls.

## Three.js

Create one material per optical look and one composer per renderer:

```js
import * as THREE from 'three';
import {
  LayeredGlassComposer,
  LayeredGlassMaterial,
} from 'three-layered-glass';

const glassMesh = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.28, 180, 32),
  new LayeredGlassMaterial({
    roughness: 0.05,
    attenuationColor: '#8bcfff',
  }),
);
scene.add(glassMesh);

const glass = new LayeredGlassComposer(renderer);
await glass.prepare(scene);

renderer.setAnimationLoop(() => {
  glass.render(scene, camera);
});

// When the experience is destroyed:
// glass.dispose();
// glassMesh.material.dispose();
```

`prepare()` makes loading deterministic. It is optional: the first `render()` starts preparation automatically and displays a fallback until the BVH is ready.

## GLB meshes

Assign the material to the mesh and prepare after the model is in the scene:

```js
const gltf = await gltfLoader.loadAsync('/product.glb');
scene.add(gltf.scene);

const glassMesh = gltf.scene.getObjectByName('Glass');
glassMesh.material = new LayeredGlassMaterial({
  ior: 1.5,
  roughness: 0.03,
  attenuationColor: '#d9f2ff',
  attenuationDistance: 2,
});

await glass.prepare(scene);
```

Volume glass expects closed, consistently wound geometry. Use `mode: 'thin'` for a window or another single-surface mesh:

```js
new LayeredGlassMaterial({
  mode: 'thin',
  thickness: 0.012,
});
```

## Material properties

The common properties follow Three.js physical-material terminology:

| Property | Default | Purpose |
| --- | ---: | --- |
| `mode` | `'volume'` | Closed volume or thin surface |
| `thickness` | `0.01` | Finite thickness used by thin mode |
| `ior` | `1.48` | Index of refraction |
| `roughness` | `0.06` | Transmission and reflection roughness, `0..1` |
| `attenuationColor` | `#b8dcff` | Color after absorption through the volume |
| `attenuationDistance` | `3.2` | Distance over which attenuation is applied |
| `dispersion` | `0.008` | Spectral separation strength |

Additional optical controls are documented in the [API reference](./docs/api.md).

## Static-scene updates

Optical properties are synchronized automatically. Geometry and world-transform changes require a new static BVH:

```js
glassMesh.position.x += 1;
glass.invalidateGeometry(glassMesh);
await glass.prepare(scene);
```

For a known-static scene, disable periodic signature checks:

```js
const glass = new LayeredGlassComposer(renderer, {
  sceneSync: 'manual',
});
```

## Post-processing

Use the dedicated subpath and replace the normal `RenderPass`:

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LayeredGlassPass } from 'three-layered-glass/postprocessing';

const post = new EffectComposer(renderer);
post.addPass(new LayeredGlassPass(scene, camera));
post.addPass(new OutputPass());
```

## Public entrypoints

| Import | Contents |
| --- | --- |
| `three-layered-glass` | Material, composer, capability check |
| `three-layered-glass/r3f` | Common declarative R3F API |
| `three-layered-glass/postprocessing` | Three.js `EffectComposer` pass |
| `three-layered-glass/r3f/postprocessing` | R3F pass registration |
| `three-layered-glass/advanced` | BVH internals, quality controller, diagnostics |
| `three-layered-glass/r3f/advanced` | Imperative R3F composer and visibility controls |
| `three-layered-glass/legacy` | 0.2/0.3 compatibility APIs |
| `three-layered-glass/r3f/legacy` | Deprecated blocker helpers |

## Requirements and limits

- Node.js 20.19 or newer for installation and project tooling.
- Three.js `WebGLRenderer` and WebGL 2.
- Static regular `Mesh` objects using `BufferGeometry`.
- Rigid transforms or topology changes require preparation again.
- `InstancedMesh`, `BatchedMesh`, continuous skinning, and live morph deformation are not part of the static ray scene.
- Transparent materials other than `LayeredGlassMaterial` are not treated as opaque ray surfaces.

## Documentation

- [Documentation index](./docs/README.md)
- [Three.js API](./docs/api.md)
- [React Three Fiber](./docs/r3f.md)
- [Performance and quality](./docs/performance.md)
- [1.0 migration guide](./docs/1.0.0-migration.md)
- [Rendering architecture](./docs/architecture.md)

## License

MIT
