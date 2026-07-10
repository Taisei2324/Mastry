import * as THREE from 'three';

export function createCrystalBodyMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xfbfeff,
    metalness: 0,
    roughness: 0.018,
    transmission: 1,
    ior: 1.52,
    thickness: 0.0042,
    attenuationColor: new THREE.Color(0xfbffff),
    attenuationDistance: 8,
    specularIntensity: 1,
    envMapIntensity: 2.4,
    side: THREE.FrontSide,
  });
}

export function createHardFacetMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.006,
    transmission: 1,
    ior: 1.545,
    thickness: 0.006,
    attenuationColor: new THREE.Color(0xffffff),
    attenuationDistance: 10,
    specularIntensity: 1,
    envMapIntensity: 3.2,
    flatShading: true,
    side: THREE.FrontSide,
  });
  if ('dispersion' in material) material.dispersion = 0.055;
  return material;
}

export function createWhiskeyMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x8f2906,
    metalness: 0,
    roughness: 0.045,
    transmission: 0.82,
    ior: 1.36,
    thickness: 0.065,
    attenuationColor: new THREE.Color(0xa83006),
    attenuationDistance: 0.14,
    specularIntensity: 0.62,
    envMapIntensity: 1.8,
    side: THREE.FrontSide,
  });
}
