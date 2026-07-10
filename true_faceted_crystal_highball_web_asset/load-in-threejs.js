import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createCrystalBodyMaterial, createHardFacetMaterial } from './materials/threejs-materials.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 20);
camera.position.set(0.26, 0.14, 0.32);

const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load('/studio.hdr', (hdr) => {
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
});

new GLTFLoader().load('/true_faceted_crystal_highball_web.glb', ({ scene: model }) => {
  const bodyMaterial = createCrystalBodyMaterial();
  const facetMaterial = createHardFacetMaterial();
  model.traverse((object) => {
    if (!object.isMesh) return;
    if (object.material?.name === 'Crystal_Cut_Facets_Hard') {
      object.material = facetMaterial;
      // Do not weld vertices or recompute smooth normals here: the hard edges are intentional.
    } else if (object.material?.name === 'Crystal_Body_Smooth') {
      object.material = bodyMaterial;
    }
  });
  scene.add(model);
});

// For visible crystal: use an HDRI, a dark floor, and tall white reflection cards on both sides.
