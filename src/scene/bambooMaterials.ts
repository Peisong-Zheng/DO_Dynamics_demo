import * as THREE from "three";

/** Warm bamboo grain made locally; no external textures or visual random stream. */
export function bambooMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#b99b5b"; context.fillRect(0,0,128,256);
  for (let x = 0; x < 128; x++) {
    const tone = 0.10 * Math.sin(x * .71) + 0.07 * Math.sin(x * 2.39) + 0.04 * Math.cos(x * 5.71);
    context.fillStyle = tone > 0 ? `rgba(250,229,169,${tone})` : `rgba(78,74,30,${-tone})`;
    context.fillRect(x,0,1,256);
  }
  const gradient = context.createLinearGradient(0,0,0,256);
  gradient.addColorStop(0,"rgba(84,82,30,.30)"); gradient.addColorStop(.08,"rgba(255,238,184,.04)");
  gradient.addColorStop(.92,"rgba(255,238,184,.04)"); gradient.addColorStop(1,"rgba(85,77,28,.25)");
  context.fillStyle = gradient; context.fillRect(0,0,128,256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map:texture, color:0xe9d3a1, roughness:.56, metalness:0 });
}
