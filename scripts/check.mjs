import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));


if (packageJson.version !== '0.4.0') {
  throw new Error('Expected package version 0.4.0.');
}

for (const requiredFile of ['CHANGELOG.md', 'docs/0.4.0-migration.md', 'docs/0.4.0-architecture.md']) {
  if (!statSync(join(root, requiredFile)).isFile()) {
    throw new Error(`Missing required release file: ${requiredFile}`);
  }
}

if (packageJson.type !== 'module') {
  throw new Error('The package must remain ESM.');
}

if (!packageJson.peerDependencies?.three) {
  throw new Error('Three.js must be declared as a peer dependency.');
}

if (!packageJson.dependencies?.['three-mesh-bvh']) {
  throw new Error('three-mesh-bvh must be declared as a runtime dependency.');
}

if (!packageJson.exports?.['./r3f']) {
  throw new Error('The React Three Fiber subpath export is missing.');
}

if (!packageJson.peerDependenciesMeta?.['@react-three/fiber']?.optional) {
  throw new Error('React Three Fiber must remain an optional peer dependency.');
}


const sourceIndex = readFileSync(join(root, 'src/index.js'), 'utf8');
for (const requiredExport of [
  'BVHLayeredGlassComposer',
  'LayeredRayScene',
  'RaySceneBuilder',
  'QUALITY_PRESETS',
]) {
  if (!sourceIndex.includes(requiredExport)) {
    throw new Error(`Missing public 0.4 export: ${requiredExport}`);
  }
}

const bvhComposerSource = readFileSync(
  join(root, 'src/BVHLayeredGlassComposer.js'),
  'utf8',
);
for (const requiredFeature of [
  'LayeredGlass.BVH.Coverage',
  'LayeredGlass.BVH.RayResolve',
  'LayeredGlass.BVH.Composite',
  'autoOpaqueIntersections',
]) {
  if (!bvhComposerSource.includes(requiredFeature)) {
    throw new Error(`Missing BVH composer feature marker: ${requiredFeature}`);
  }
}

const rayBuilderSource = readFileSync(
  join(root, 'src/ray-scene/RaySceneBuilder.js'),
  'utf8',
);
if (!rayBuilderSource.includes('RAY_VISIBILITY.OPAQUE')) {
  throw new Error('Automatic opaque ray-scene classification is missing.');
}

function collectJavaScriptFiles(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) collectJavaScriptFiles(path, files);
    if (stats.isFile() && path.endsWith('.js')) files.push(path);
  }
  return files;
}

for (const file of collectJavaScriptFiles(join(root, 'src'))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

for (const file of collectJavaScriptFiles(join(root, 'demo'))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log('Source syntax and package metadata checks passed.');
