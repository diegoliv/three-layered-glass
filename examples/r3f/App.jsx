import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  LayeredGlass,
  LayeredGlassComposer,
  LayeredGlassMaterial,
} from 'three-layered-glass/r3f';

function Scene() {
  return (
    <LayeredGlassComposer
      backend="bvh"
      quality="medium"
      worker
      renderPriority={1}
      depthMode="opaque"
    >
      <ambientLight intensity={1.5} />
      <directionalLight position={[-3, 5, 4]} intensity={3} />

      <mesh position={[-0.9, 0, 0]}>
        <torusKnotGeometry args={[0.82, 0.28, 180, 32]} />
        <LayeredGlassMaterial
          ior={1.48}
          roughness={0.06}
          attenuationColor="#b8dcff"
          attenuationDistance={3.2}
          dispersion={0.008}
        />
      </mesh>

      <LayeredGlass
        position={[0.9, 0, -0.4]}
        materialProps={{
          ior: 1.52,
          roughness: 0.04,
          attenuationColor: '#ff9ec4',
          attenuationDistance: 3.6,
        }}
      >
        <icosahedronGeometry args={[1, 5]} />
      </LayeredGlass>

      {/* Ordinary opaque meshes are included automatically. */}
      <mesh position={[0, 0, -3]}>
        <boxGeometry args={[2.5, 2.5, 0.2]} />
        <meshStandardMaterial color="#ff6b35" />
      </mesh>

      <OrbitControls />
    </LayeredGlassComposer>
  );
}

export default function App() {
  return (
    <Canvas camera={{ position: [0, 0, 7], fov: 40 }}>
      <Scene />
    </Canvas>
  );
}
