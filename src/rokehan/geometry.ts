import * as THREE from 'three';

export interface OSMBuilding {
  id: number;
  coordinates: [number, number][];
  tags: Record<string, string>;
}

export interface OSMTree {
  coordinates: [number, number];
  tags: Record<string, string>;
}

export interface BuildingStyle {
  wall: THREE.ColorRepresentation;
  roof: THREE.ColorRepresentation;
  trim: THREE.ColorRepresentation;
}

const palette: BuildingStyle[] = [
  { wall: '#e7d8bd', roof: '#9b5542', trim: '#f5ead7' },
  { wall: '#d6c7ad', roof: '#6d7073', trim: '#f2e7d4' },
  { wall: '#eadfc9', roof: '#a66c4e', trim: '#fff3df' },
  { wall: '#c9c3b4', roof: '#77736c', trim: '#eee8dc' },
  { wall: '#e4c9a8', roof: '#8e493d', trim: '#f8e9d3' },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function seeded(id: number, salt: number): number {
  const value = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function inferHeight(tags: Record<string, string>, area: number, id: number): number {
  const explicit = Number.parseFloat(tags.height || '');
  if (Number.isFinite(explicit) && explicit > 2) return clamp(explicit, 3, 180);
  const levels = Number.parseFloat(tags['building:levels'] || tags.levels || '');
  if (Number.isFinite(levels) && levels > 0) return clamp(levels * 3.1, 3.2, 180);
  const kind = tags.building || 'yes';
  const base = kind.includes('apart') || kind.includes('residential') ? 9.5
    : kind.includes('commercial') || kind.includes('office') ? 12
    : kind.includes('industrial') ? 7 : 5.5;
  return clamp(base + Math.sqrt(Math.max(0, area)) * 0.34 + seeded(id, 7) * 5, 4, 32);
}

function signedArea(points: THREE.Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

function makeRoof(points: THREE.Vector2[], height: number, roofHeight: number, roofShape: string, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  points.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
  shape.closePath();

  if (roofShape === 'flat' || roofHeight < 0.4 || points.length < 4) {
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height;
    group.add(mesh);
    return group;
  }

  // A restrained gable roof: the footprint remains the real OSM outline;
  // the ridge follows the longer footprint axis rather than using a generic cube.
  const box = new THREE.Box2().setFromPoints(points);
  const size = box.getSize(new THREE.Vector2());
  const alongX = size.x >= size.y;
  const ridge = alongX ? (box.min.y + box.max.y) / 2 : (box.min.x + box.max.x) / 2;
  const vertices: number[] = [];
  const indices: number[] = [];
  const center = new THREE.Vector2();
  points.forEach(p => center.add(p));
  center.multiplyScalar(1 / points.length);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
    const ridgePoint = alongX
      ? new THREE.Vector2(mid.x, ridge)
      : new THREE.Vector2(ridge, mid.y);
    const base = vertices.length / 3;
    vertices.push(a.x, height, -a.y, b.x, height, -b.y, ridgePoint.x, height + roofHeight, -ridgePoint.y);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, material));
  return group;
}

export function buildBuildingMesh(
  building: OSMBuilding,
  project: (lng: number, lat: number) => THREE.Vector2,
): THREE.Group | null {
  const ring = building.coordinates;
  if (ring.length < 4) return null;
  const points = ring.slice(0, -1).map(([lng, lat]) => project(lng, lat));
  if (points.length < 3) return null;
  if (signedArea(points) < 0) points.reverse();

  const shape = new THREE.Shape();
  points.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
  shape.closePath();

  const box = new THREE.Box2().setFromPoints(points);
  const area = Math.abs(signedArea(points));
  const height = inferHeight(building.tags, area, building.id);
  const levels = Math.max(1, Math.round(height / 3.1));
  const roofShape = building.tags['roof:shape'] || (building.tags['building:levels'] ? 'flat' : 'gabled');
  const style = palette[Math.floor(seeded(building.id, 2) * palette.length)];
  const group = new THREE.Group();

  const wallGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // ExtrudeGeometry is XY with depth along +Z. Rotate to an X/Z ground plane, Y up.
  wallGeometry.rotateX(-Math.PI / 2);
  wallGeometry.translate(0, 0, 0);
  const walls = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({
    color: style.wall, roughness: 0.92, metalness: 0,
  }));
  group.add(walls);

  const roofMaterial = new THREE.MeshStandardMaterial({ color: style.roof, roughness: 0.88 });
  const roofHeight = roofShape === 'flat' ? 0 : clamp(Math.min(box.max.x - box.min.x, box.max.y - box.min.y) * 0.22, 0.8, 4.5);
  group.add(makeRoof(points, height, roofHeight, roofShape, roofMaterial));

  // Storey bands and inset-looking window panels are only added to medium/near LOD.
  if (area > 90 && height > 6) {
    const trim = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.75 });
    const glass = new THREE.MeshStandardMaterial({ color: '#78939a', roughness: 0.34, metalness: 0.12 });
    const windowWidth = 0.85;
    const windowHeight = 1.15;
    const minX = box.min.x, maxX = box.max.x, minY = box.min.y, maxY = box.max.y;
    const cols = clamp(Math.floor((maxX - minX) / 3.2), 1, 16);
    const rows = clamp(Math.floor(height / 3.2), 1, 22);
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(windowWidth, windowHeight, 0.07), glass, cols * rows * 2);
    const bands = new THREE.InstancedMesh(new THREE.BoxGeometry(windowWidth + 0.12, 0.08, 0.09), trim, cols * rows * 2);
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let side = 0; side < 2; side++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = minX + (col + 0.5) * (maxX - minX) / cols;
          const z = side === 0 ? -minY - 0.045 : -maxY + 0.045;
          const y = 1.35 + row * 3.05;
          dummy.position.set(x, y, z);
          dummy.rotation.y = side === 0 ? 0 : Math.PI;
          dummy.updateMatrix();
          windows.setMatrixAt(index, dummy.matrix);
          dummy.position.y = y - 0.72;
          dummy.updateMatrix();
          bands.setMatrixAt(index, dummy.matrix);
          index++;
        }
      }
    }
    windows.count = index;
    bands.count = index;
    group.add(windows, bands);
  }

  group.userData = { osmId: building.id, height, levels, roofShape };
  return group;
}

export function buildTreeMesh(tree: OSMTree, project: (lng: number, lat: number) => THREE.Vector2): THREE.Group {
  const p = project(tree.coordinates[0], tree.coordinates[1]);
  const group = new THREE.Group();
  const id = Math.round((tree.coordinates[0] * 100000) + (tree.coordinates[1] * 1000000));
  const height = clamp(Number.parseFloat(tree.tags.height || '') || 5 + seeded(id, 3) * 3, 3, 13);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.2, height * 0.42, 6),
    new THREE.MeshStandardMaterial({ color: '#70513b', roughness: 1 }),
  );
  trunk.position.y = height * 0.21;
  group.add(trunk);

  const crownMaterial = new THREE.MeshStandardMaterial({
    color: tree.tags.leaf_type === 'needleleaved' ? '#315b43' : ['#567c4b', '#668653', '#78915a'][Math.floor(seeded(id, 9) * 3)],
    roughness: 1,
  });
  const crown = new THREE.Group();
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const radius = (height * 0.25) * (1 - i * 0.2);
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), crownMaterial);
    blob.position.set((seeded(id, i + 10) - 0.5) * 0.35, height * (0.52 + i * 0.16), (seeded(id, i + 20) - 0.5) * 0.35);
    blob.scale.set(1, 0.9 + seeded(id, i + 30) * 0.35, 1);
    crown.add(blob);
  }
  group.add(crown);
  // The custom MapLibre matrix uses Y southward and Z upward after the root basis rotation.
  group.position.set(p.x, 0, -p.y);
  group.userData = { osmTree: true };
  return group;
}

export function buildGroundPlane(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: '#c9c6ad', roughness: 1 });
  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  return ground;
}
