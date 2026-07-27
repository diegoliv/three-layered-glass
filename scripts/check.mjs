import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));


if (packageJson.version !== '1.0.0') {
  throw new Error('Expected package version 1.0.0.');
}

for (const requiredFile of [
  'CHANGELOG.md',
  'package-lock.json',
  'docs/api.md',
  'docs/architecture.md',
  'docs/README.md',
  'docs/r3f.md',
  'docs/performance.md',
  'docs/1.0.0-migration.md',
]) {
  if (!statSync(join(root, requiredFile)).isFile()) {
    throw new Error(`Missing required release file: ${requiredFile}`);
  }
}

if (packageJson.type !== 'module') {
  throw new Error('The package must remain ESM.');
}

if (packageJson.engines?.node !== '>=20.19') {
  throw new Error('Version 1.0 requires Node 20.19 or newer.');
}

if (!packageJson.peerDependencies?.three) {
  throw new Error('Three.js must be declared as a peer dependency.');
}

if (!packageJson.scripts?.typecheck) {
  throw new Error('The public typecheck script is missing.');
}

if (!packageJson.dependencies?.['three-mesh-bvh']) {
  throw new Error('three-mesh-bvh must be declared as a runtime dependency.');
}

for (const subpath of [
  '.',
  './advanced',
  './legacy',
  './postprocessing',
  './r3f',
  './r3f/advanced',
  './r3f/legacy',
  './r3f/postprocessing',
]) {
  if (!packageJson.exports?.[subpath]) {
    throw new Error(`Missing public 1.0 subpath export: ${subpath}`);
  }
  for (const condition of ['types', 'import', 'default']) {
    const exportedPath = packageJson.exports[subpath][condition];
    const resolvedExportPath = exportedPath && join(root, exportedPath);
    if (
      !resolvedExportPath
      || !existsSync(resolvedExportPath)
      || !statSync(resolvedExportPath).isFile()
    ) {
      throw new Error(
        `Invalid ${condition} target for ${subpath}: ${exportedPath}`,
      );
    }
  }
}

if (!packageJson.peerDependenciesMeta?.['@react-three/fiber']?.optional) {
  throw new Error('React Three Fiber must remain an optional peer dependency.');
}

for (const markdownPath of [
  'README.md',
  'docs/README.md',
  'docs/api.md',
  'docs/architecture.md',
  'docs/r3f.md',
  'docs/performance.md',
  'docs/1.0.0-migration.md',
]) {
  const markdown = readFileSync(join(root, markdownPath), 'utf8');
  for (const match of markdown.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]+)?\)/g)) {
    const linkedPath = resolve(dirname(join(root, markdownPath)), match[1]);
    if (!existsSync(linkedPath) || !statSync(linkedPath).isFile()) {
      throw new Error(`Broken local link in ${markdownPath}: ${match[1]}`);
    }
  }
}


for (const [entrypoint, requiredExports] of Object.entries({
  'src/index.js': [
    'LayeredGlassComposer',
    'LayeredGlassMaterial',
    'supportsLayeredGlass',
  ],
  'src/advanced.js': [
    'BVHLayeredGlassComposer',
    'LayeredGlassAdaptiveQuality',
    'LayeredRayScene',
    'RaySceneBuilder',
    'QUALITY_PRESETS',
  ],
  'src/postprocessing.js': ['LayeredGlassPass'],
  'src/legacy.js': ['LegacyLayeredGlassComposer'],
  'src/r3f/index.js': [
    'LayeredGlassComposer',
    'LayeredGlassMaterial',
    'useLayeredGlass',
  ],
})) {
  const source = readFileSync(join(root, entrypoint), 'utf8');
  for (const requiredExport of requiredExports) {
    if (!source.includes(requiredExport)) {
      throw new Error(`Missing ${requiredExport} from ${entrypoint}.`);
    }
  }
}

const bvhComposerSource = readFileSync(
  join(root, 'src/BVHLayeredGlassComposer.js'),
  'utf8',
);
for (const requiredFeature of [
  'LayeredGlass.BVH.Surface',
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

const demoSource = readFileSync(join(root, 'demo/main.js'), 'utf8');
const demoAdvancedImport = demoSource.match(
  /import\s*\{([^}]+)\}\s*from '\.\.\/src\/advanced\.js';/,
);
if (
  !demoAdvancedImport
  || !demoAdvancedImport[1].includes('LayeredGlassComposer')
  || !demoAdvancedImport[1].includes('LayeredGlassAdaptiveQuality')
) {
  throw new Error(
    'The tuned demo must import advanced compositor controls from src/advanced.js.',
  );
}

for (const deprecatedDemoApi of ['RGBELoader', 'PCFSoftShadowMap']) {
  if (demoSource.includes(deprecatedDemoApi)) {
    throw new Error(`The demo still uses deprecated Three.js API: ${deprecatedDemoApi}`);
  }
}

console.log('Source syntax and package metadata checks passed.');
