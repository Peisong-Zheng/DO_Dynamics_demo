import * as THREE from "three";

export interface Vertex3 { x: number; y: number; z: number }

/** Reusable triangulation buffers for the convex chamber and clipped water mesh. */
export function createPolyhedronMesh(material: THREE.Material, capacity = 2200) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(new Float32Array(capacity * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(vertices: readonly Vertex3[], faces: readonly (readonly number[])[], yOffset = 0) {
      let index = 0;
      for (const face of faces) for (let i = 1; i < face.length - 1; i++) {
        for (const v of [face[0], face[i], face[i + 1]]) {
          const point = vertices[v];
          if (index >= capacity) throw new Error("Chamber triangulation exceeds its render buffer.");
          positions.setXYZ(index++, point.x, point.y + yOffset, point.z);
        }
      }
      positions.needsUpdate = true;
      geometry.setDrawRange(0, index);
      geometry.computeVertexNormals();
      mesh.visible = index > 0;
    },
  };
}

export function cylinderBetween(parent: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, sides=32) {
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, sides), material);
  const delta = b.clone().sub(a);
  cylinder.position.copy(a).add(b).multiplyScalar(.5);
  cylinder.scale.y = delta.length();
  cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
  cylinder.castShadow = !material.transparent; cylinder.receiveShadow = true;
  parent.add(cylinder);
  return cylinder;
}

/** Straight runs joined by quarter-bend fillets, so a pipe never meets itself end-on. */
export function roundedPipePath(points: readonly THREE.Vector3[], cornerRadius: number) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cursor = points[0].clone();
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1], corner = points[i], next = points[i + 1];
    const inDirection = corner.clone().sub(previous).normalize();
    const outDirection = next.clone().sub(corner).normalize();
    const trim = Math.min(cornerRadius, corner.distanceTo(previous) / 2, corner.distanceTo(next) / 2);
    const start = corner.clone().addScaledVector(inDirection, -trim);
    const end = corner.clone().addScaledVector(outDirection, trim);
    path.add(new THREE.LineCurve3(cursor.clone(), start));
    path.add(new THREE.QuadraticBezierCurve3(start, corner.clone(), end));
    cursor = end;
  }
  path.add(new THREE.LineCurve3(cursor, points[points.length - 1].clone()));
  return path;
}

export function createStream(parent: THREE.Group, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,12), material);
  parent.add(mesh);
  return {
    mesh,
    update(a: Vertex3, b: Vertex3, radius: number, visible: boolean) {
      mesh.visible = visible;
      if (!visible) return;
      const delta = new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z);
      mesh.position.set((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
      mesh.scale.set(radius,delta.length(),radius);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    },
  };
}
