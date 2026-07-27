# Rendering architecture

Version 1.0 uses a static triangle-BVH ray scene alongside the normal Three.js raster scene. The compositor does not create another WebGL context and does not replace opaque materials.

## Frame pipeline

```text
normal opaque Three.js scene + depth
  → rasterized glass surface and coverage
  → reduced-resolution BVH transmission
  → edge-aware full-resolution composite
  → foreground transparency
  → screen, target, or post-processing chain
```

The surface pass preserves the nearest front reflection and the exact visible glass contour. Expensive multi-layer transmission is evaluated only inside that coverage and can run at a lower resolution.

## Static ray scene

During `prepare(scene)`, visible regular meshes are classified per material group:

```text
LayeredGlassMaterial       → glass ray surface
opaque material            → opaque ray surface
other transparent material → ignored
explicit visibility value  → override wins
```

Source triangles are transformed into world space and flattened into one non-indexed `BufferGeometry`. Per-triangle attributes store surface classification, volume identity, optical properties, normals, and opaque fallback color.

`three-mesh-bvh` builds the acceleration structure. A worker is used when available; otherwise preparation falls back to the main thread.

## Ray traversal

For every covered transmission pixel, the resolver repeatedly finds the nearest triangle hit:

- an opaque hit terminates the path;
- a thin-glass hit applies a finite slab approximation and continues;
- a volume-glass hit updates the medium stack, refracts, attenuates, and continues.

The medium stack tracks volume identity rather than assuming every exit belongs to the most recently entered object. This allows deterministic nested and intersecting glass layers within the configured traversal and media limits.

Medium and high quality evaluate separate spectral paths. Rough transmission keeps the geometric interface normal stable and applies a terminal filter plus a multi-resolution blur to downstream radiance. The primary outside silhouette and front reflection remain sharp.

## Opaque shading

When a ray terminates at an opaque hit visible in the normal camera render, the compositor reuses the fully shaded raster color. Hidden or off-screen hits use material base color and a deterministic environment response.

Opaque meshes therefore retain their normal Three.js materials, lights, shadows, and raster behavior.

## Scene synchronization

The composer tracks two signatures:

- geometry: topology, transforms, visibility classification, draw ranges, and groups;
- material: glass optics and opaque fallback values.

Optical-only changes refresh GPU metadata. Geometry changes require static preparation because world-space triangles and their BVH bounds have changed.

Automatic signature checks are rate-limited. Manual mode removes that polling when the application already has an explicit invalidation pipeline.

## Backend facade

The public composer defaults to `auto`:

- `auto` prepares the static BVH and uses the analytic or base fallback while loading;
- `bvh` selects static real-triangle traversal directly;
- `analytic` retains the primitive-proxy renderer for specialized scenes.

Backend selection is an advanced integration control. The primary API does not require users to select one.

## Static-stage limits

- World transforms and topology are baked during preparation.
- Rigid transform changes require another BVH build.
- Instancing, batching, continuous skinning, and live morph deformation are excluded.
- Volume glass depends on closed, consistently wound geometry.
- Non-glass transparent materials do not become opaque ray surfaces automatically.
- Reflections use an environment response rather than recursive reflected-geometry traversal.

See [Performance and quality](./performance.md) for resolution, synchronization, and geometry-budget controls.
