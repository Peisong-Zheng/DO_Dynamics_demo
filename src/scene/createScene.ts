import * as THREE from "three";
import type { SimulationView, TankState } from "../simulation/types";
import { createTank, type TankVisual } from "./tank";
import { PIVOT_HEIGHT, FEED_X, FEED_Y, counterweightPosition, thresholdForCounterweight, rotatePoint } from "./tiltingGeometry";
import { createFallback } from "./fallback";
import { createCounterweightControls, type ThresholdChange } from "./counterweightControls";
import "./scene.css";

type AnnotationKind = "inflow" | "counterweight" | "pivot" | "slow";
interface Annotation { element: HTMLElement; kind: AnnotationKind; position: THREE.Vector3 }

export function createScene(host: HTMLElement, { reducedMotion = false, onThresholdChange }: { reducedMotion?: boolean; onThresholdChange?: ThresholdChange } = {}) {
  let fallback: ReturnType<typeof createFallback> | undefined;
  let latest: SimulationView | undefined;
  let disposed = false;
  let renderer: THREE.WebGLRenderer;
  try {
    if (new URLSearchParams(location.search).get("webgl") === "0") throw new Error("Requested 2D presentation");
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    fallback = createFallback(host, {onThresholdChange});
    return { isFallback: true, update(view: SimulationView) { fallback?.update(view); }, dispose() { fallback?.dispose(); } };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 2.1, -2.1, 0.1, 80);
  camera.position.set(0, 9, 20);
  camera.lookAt(0, 1.6, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa6ad93, 2.6));
  const key = new THREE.DirectionalLight(0xfff5df, 3.0);
  key.position.set(-3, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10; key.shadow.camera.right = 10;
  key.shadow.camera.top = 10; key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.001; key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe3ede6, 1.5);
  fill.position.set(5, 5, -4); scene.add(fill);
  const tanks = [createTank(0x267e79, reducedMotion), createTank(0x4a859f, reducedMotion)];
  tanks.forEach(tank => {tank.group.rotation.y=-.18;scene.add(tank.group);});
  const overlays = document.createElement("div");
  overlays.className = "scene-annotations";
  host.append(overlays);
  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.classList.add("scene-leaders");
  overlays.append(leaders);
  const slowLeaders = tanks.map(() => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    leaders.append(path); return path;
  });
  const annotations = tanks.map(() => (["inflow", "counterweight", "pivot", "slow"] as AnnotationKind[]).map(kind => {
    const element = document.createElement("div");
    element.className = `scene-annotation annotation-${kind}`;
    overlays.append(element);
    return { element, kind, position: new THREE.Vector3() } as Annotation;
  }));
  const weightControls=createCounterweightControls(host,onThresholdChange);
  const railStartX=counterweightPosition(.55),railEndX=counterweightPosition(1.65);
  let width = 1, height = 1;
  const projected = new THREE.Vector3();
  const tankMatrix = new THREE.Matrix4();
  const projectPoint=(p:{x:number;y:number;z:number})=>{
    projected.set(p.x,p.y,p.z).applyMatrix4(tankMatrix).project(camera);
    return {x:(projected.x*.5+.5)*width,y:(-projected.y*.5+.5)*height};
  };
  function annotationContent({ element, kind, position }: Annotation, state: TankState, tank: TankVisual) {
    let text = "";
    switch (kind) {
      case "inflow":
        position.set(FEED_X-.48, FEED_Y+.31, 0);
        text = `<strong>Inflow</strong><span class="annotation-value">q ${state.q.toFixed(3)}</span>`;
        break;
      case "counterweight":
        position.set(tank.anchors.weight.x-.04,tank.anchors.weight.y+.64,.1);
        text = `Drag weight<span class="annotation-value">tip at ${state.params.H.toFixed(2)}</span>`;
        break;
      case "pivot":
        position.set(-.39, .86, .7);
        text = "Pivot";
        break;
      case "slow":
        position.set(.12, -.02, 0);
        text = "Slow leak";
        break;
    }
    if (element.innerHTML !== text) element.innerHTML = text;
  }
  const placements: { element: HTMLElement; x: number; y: number; half: number }[] = [];
  function draw() {
    if (!latest || disposed || fallback) return;
    tanks.forEach((tank, index) => {
      tank.update(latest!.tanks[index], latest!.time);
      tank.group.updateWorldMatrix(true, false);
      tankMatrix.copy(tank.group.matrixWorld);
      // Measure every label before writing any position: interleaving the reads
      // and writes would force a synchronous layout for each of the overlays.
      placements.length = 0;
      let slowLabel = { x: 0, y: 0 };
      annotations[index].forEach(annotation => {
        annotationContent(annotation, latest!.tanks[index], tank);
        const point = projectPoint(annotation.position);
        placements.push({ element: annotation.element, x: point.x, y: point.y, half: annotation.element.offsetWidth / 2 });
        if (annotation.kind === "slow") slowLabel = point;
      });
      placements.forEach(({ element, x, y, half }) => {
        element.style.left = `${Math.max(half + 5, Math.min(width - half - 62, x))}px`;
        element.style.top = `${y}px`;
      });
      // The threshold sliders stay in fixed gutters beside each reservoir, clear
      // of the apparatus, so they never move while the vessel tilts.
      const outlet = tank.anchors.leak;
      const leakPoint = projectPoint({ x: outlet.x, y: .30, z: outlet.z });
      slowLeaders[index].setAttribute("d", `M ${slowLabel.x + 16} ${slowLabel.y - 3} L ${leakPoint.x - 4} ${leakPoint.y}`);
      const railPoint=(x:number)=>{const p=rotatePoint({x,y:0,z:0},latest!.tanks[index].angle);return projectPoint({...p,y:p.y+PIVOT_HEIGHT});};
      weightControls.update(index as 0|1,{
        center:projectPoint(tank.anchors.weight),railStart:railPoint(railStartX),railEnd:railPoint(railEndX),
        threshold:latest!.tanks[index].params.H,
        thresholdAtFraction:(fraction)=>thresholdForCounterweight(railStartX+(railEndX-railStartX)*fraction),
      });
    });
    renderer.render(scene, camera);
  }
  function resize() {
    if (disposed || fallback) return;
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const mobile = window.matchMedia("(max-width: 699px)").matches;
    const mobileScale = Math.min(width / 5.7, (height / 2 - 160) / 3.5);
    const visibleHeight = mobile ? height / mobileScale : Math.max(4.3, 10.8 * height / width);
    const visibleWidth = visibleHeight * width / height;
    camera.left = -visibleWidth / 2; camera.right = visibleWidth / 2;
    camera.top = visibleHeight / 2; camera.bottom = -visibleHeight / 2;
    camera.updateProjectionMatrix();
    tanks.forEach((tank, i) => tank.group.position.set(
      mobile ? -.85 : visibleWidth * (i === 0 ? -0.25 : 0.25) - .56,
      mobile ? visibleHeight * (i === 0 ? 0.25 : -0.25) / Math.cos(Math.atan(7.4 / 20)) - 0.60 : -0.08,
      0,
    ));
    renderer.setSize(width, height, false);
    draw();
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  function onContextLost(event: Event) {
    event.preventDefault();
    if (disposed || fallback) return;
    observer.disconnect(); renderer.domElement.style.display = "none";
    overlays.style.display = "none"; weightControls.dispose();
    fallback = createFallback(host, {onThresholdChange}); if (latest) fallback.update(latest);
  }
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  return {
    get isFallback() { return Boolean(fallback); },
    update(view: SimulationView) {
      latest = view;
      if (fallback) fallback.update(view);
      // Layout can settle before ResizeObserver fires (including under a paused
      // test clock). Never project a new frame using the old viewport size.
      else if (Math.abs(host.clientWidth - width) > 1 || Math.abs(host.clientHeight - height) > 1) resize();
      else draw();
    },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
        }
      });
      geometries.forEach(g => g.dispose());
      materials.forEach(m => {if(m instanceof THREE.MeshStandardMaterial&&m.map)textures.add(m.map);m.dispose();});
      textures.forEach(texture=>texture.dispose());
      key.shadow.dispose(); renderer.dispose(); renderer.domElement.remove(); overlays.remove(); weightControls.dispose(); fallback?.dispose();
    },
  };
}
