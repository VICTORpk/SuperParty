import * as THREE from "three";

/** Sombreado de desenho: poucos tons bem marcados (como pintura em "cel"). Compartilhado por todo o jogo. */
let gradientMap: THREE.DataTexture | null = null;
export function getGradient(): THREE.DataTexture {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([105, 105, 105, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

export const INK_COLOR = "#2b1b17";
