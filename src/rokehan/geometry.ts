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
  glass: THREE.ColorRepresentation;
}

const palette: BuildingStyle[] = [
  { wall: '#e7d8bd', roof: '#9b5542', trim: '#f5ead7', glass: '#78939a' },
  { wall: '#d6c7ad', roof: '#6d7073', trim: '#f2e7d4', glass: '#718e9b' },
  { wall: '#eadfc9', roof: '#a66c4e', trim: '#fff3df', glass: '#668995' },
  { wall: '#c9c3b4', roof: '#77736c', trim: '#eee8dc', glass: '#7e999d' },
  { wall: '#e4c9a8', roof: '#8e493d', trim: '#f8e9d3', glass: '#6d8791' },
  { wall: '#d9d0c2', roof: '#5d6265', trim: '#f4eee4', glass: '#829ca3' },
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

function makeRoof(
  points: THREE.Vector2[],
  height: number,
  roofHeight: number,
  roofShape: string,
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  points.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
  shape.closePath();

  const flatRoof = () => {
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height;
    group.add(mesh);
  };
  if (roofShape === 'flat' || roofHeight < 0.4 || points.length < 4) {
    flatRoof();
    return group;
  }

  const box = new THREE.Box2().setFromPoints(points);
  const size = box.getSize(new THREE.Vector2());
  const center = new THREE.Vector2();
  points.forEach(point => center.add(point));
  center.multiplyScalar(1 / points.length);
  const vertices: number[] = [];
  const indices: number[] = [];
  const addTriangle = (a: THREE.Vector2, b: THREE.Vector2, d: THREE.Vector2, ya: number, yb: number, yd: number) => {
    const base = vertices.length / 3;
    vertices.push(a.x, ya, -a.y, b.x, yb, -b.y, d.x, yd, -d.y);
    indices.push(base, base + 1, base + 2);
  };

  if (roofShape === 'pyramidal' || roofShape === 'cone') {
    const apex = center;
    for (let i = 0; i < points.length; i++) {
      addTriangle(points[i], points[(i + 1) % points.length], apex, height, height, height + roofHeight);
    }
  } else if (roofShape === 'hipped') {
    // Inset ridge cap with sloped hips around the complete OSM footprint.
    const inset = points.map(point => new THREE.Vector2(
      center.x + (point.x - center.x) * 0.58,
      center.y + (point.y - center.y) * 0.58,
    ));
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      addTriangle(points[i], points[j], inset[j], height, height, height + roofHeight);
      addTriangle(points[i], inset[j], inset[i], height, height + roofHeight, height + roofHeight);
    }
    const cap = new THREE.Shape();
    inset.forEach((point, i) => i ? cap.lineTo(point.x, point.y) : cap.moveTo(point.x, point.y));
    cap.closePath();
    const capGeometry = new THREE.ShapeGeometry(cap);
    capGeometry.rotateX(-Math.PI / 2);
    const capMesh = new THREE.Mesh(capGeometry, material);
    capMesh.position.y = height + roofHeight;
    group.add(capMesh);
  } else if (roofShape === 'skillion' || roofShape === 'shed') {
    const alongX = size.x >= size.y;
    const min = alongX ? box.min.y : box.min.x;
    const max = alongX ? box.max.y : box.max.x;
    const span = Math.max(0.01, max - min);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const ya = height + roofHeight * ((alongX ? a.y : a.x) - min) / span;
      const yb = height + roofHeight * ((alongX ? b.y : b.x) - min) / span;
      addTriangle(a, b, center, ya, yb, height + roofHeight * 0.5);
    }
  } else {
    // Gabled roof: two sloping planes meet along the longer footprint axis.
    const alongX = size.x >= size.y;
    const ridge = alongX ? (box.min.y + box.max.y) / 2 : (box.min.x + box.max.x) / 2;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
      const ridgePoint = alongX
        ? new THREE.Vector2(mid.x, ridge)
        : new THREE.Vector2(ridge, mid.y);
      addTriangle(a, b, ridgePoint, height, height, height + roofHeight);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, material));
  return group;
}

function addFacadeDetails(
  group: THREE.Group,
  points: THREE.Vector2[],
  box: THREE.Box2,
  height: number,
  style: BuildingStyle,
  id: number,
  buildingTags: Record<string, string>,
) {
  const area = Math.abs(signedArea(points));
  if (area < 35 || height < 5.5) return;

  const floorHeight = clamp(Number.parseFloat(buildingTags['building:levels'] || '') > 0
    ? height / Number.parseFloat(buildingTags['building:levels'])
    : 3.05, 2.55, 4.2);
  const floors = Math.max(1, Math.min(32, Math.floor((height - 0.4) / floorHeight)));
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: style.glass, roughness: 0.32, metalness: 0.12,
    emissive: '#18272b', emissiveIntensity: 0.08,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.78 });
  const balconyMaterial = new THREE.MeshStandardMaterial({ color: '#d5c7b1', roughness: 0.82 });

  const windowGeometry = new THREE.BoxGeometry(0.92, 1.18, 0.075);
  const frameGeometry = new THREE.BoxGeometry(1.08, 1.34, 0.055);
  const sillGeometry = new THREE.BoxGeometry(1.12, 0.10, 0.13);
  const balconyGeometry = new THREE.BoxGeometry(1.55, 0.10, 0.72);
  const railGeometry = new THREE.BoxGeometry(1.55, 0.48, 0.055);
  const dummy = new THREE.Object3D();
  const placements: { x: number; y: number; z: number; angle: number; balcony: boolean }[] = [];

  // Build facade rows along every real footprint edge, not just the bounding-box north/south sides.
  for (let edge = 0; edge < points.length; edge++) {
    const a = points[edge], b = points[(edge + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 2.8) continue;

    // For the normalized counter-clockwise ring, this is the outward normal in the X/Z plane.
    const nx = dy / length;
    const nz = dx / length;
    const angle = Math.atan2(nx, nz);
    const columns = Math.max(1, Math.floor(length / 2.7));
    const spacing = length / columns;

    for (let floor = 0; floor < floors; floor++) {
      const y = 1.25 + floor * floorHeight;
      if (y + 1.3 > height - 0.15) continue;
      for (let col = 0; col < columns; col++) {
        const t = (col + 0.5) / columns;
        const x = a.x + dx * t + nx * 0.055;
        const z = -(a.y + dy * t) + nz * 0.055;
        const balcony = floor > 0 && spacing > 3.6 && seeded(id + edge * 31 + col, floor + 19) > 0.76;
        placements.push({ x, y, z, angle, balcony });
      }
    }
  }

  if (!placements.length) return;
  const windows = new THREE.InstancedMesh(windowGeometry, glassMaterial, placements.length);
  const frames = new THREE.InstancedMesh(frameGeometry, trimMaterial, placements.length);
  const sills = new THREE.InstancedMesh(sillGeometry, trimMaterial, placements.length);
  const balconyCount = placements.filter(p => p.balcony).length;
  const balconies = new THREE.InstancedMesh(balconyGeometry, balconyMaterial, Math.max(1, balconyCount));
  const rails = new THREE.InstancedMesh(railGeometry, trimMaterial, Math.max(1, balconyCount));

  let balconyIndex = 0;
  placements.forEach((p, index) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.angle, 0);
    dummy.updateMatrix();
    windows.setMatrixAt(index, dummy.matrix);

    dummy.position.y = p.y;
    dummy.scale.set(1.12, 1.12, 1);
    dummy.updateMatrix();
    frames.setMatrixAt(index, dummy.matrix);
    dummy.scale.set(1, 1, 1);

    dummy.position.y = p.y - 0.68;
    dummy.updateMatrix();
    sills.setMatrixAt(index, dummy.matrix);

    if (p.balcony) {
      // Balconies project outward from the facade, with a light parapet rail.
      dummy.position.set(p.x + Math.sin(p.angle) * 0.34, p.y - 0.52, p.z + Math.cos(p.angle) * 0.34);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      balconies.setMatrixAt(balconyIndex, dummy.matrix);
      dummy.position.y = p.y - 0.24;
      dummy.position.x += Math.sin(p.angle) * 0.30;
      dummy.position.z += Math.cos(p.angle) * 0.30;
      dummy.updateMatrix();
      rails.setMatrixAt(balconyIndex, dummy.matrix);
      balconyIndex++;
    }
  });

  windows.count = placements.length;
  frames.count = placements.length;
  sills.count = placements.length;
  balconies.count = balconyIndex;
  rails.count = balconyIndex;
  group.add(windows, frames, sills);
  if (balconyIndex) group.add(balconies, rails);

  // Thin continuous floor slabs emphasize storeys on medium and large buildings.
  const floorBands: THREE.Vector3[] = [];
  for (let floor = 1; floor < floors; floor++) {
    const y = floor * floorHeight;
    if (y >= height - 0.3) break;
    for (let edge = 0; edge < points.length; edge++) {
      const a = points[edge], b = points[(edge + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 2) continue;
      const nx = dy / length, nz = dx / length;
      const midX = (a.x + b.x) / 2 + nx * 0.045;
      const midZ = -(a.y + b.y) / 2 + nz * 0.045;
      floorBands.push(new THREE.Vector3(midX, y, midZ));
    }
  }
  if (floorBands.length) {
    const band = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.10, 0.12), trimMaterial, floorBands.length,
    );
    let index = 0;
    for (let edge = 0; edge < points.length; edge++) {
      const a = points[edge], b = points[(edge + 1) % points.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 2) continue;
      const angle = Math.atan2((b.y - a.y) / length, (b.x - a.x) / length);
      for (let floor = 1; floor < floors; floor++) {
        const y = floor * floorHeight;
        if (y >= height - 0.3) break;
        const p = floorBands[index];
        dummy.position.copy(p);
        dummy.rotation.set(0, -angle, 0);
        dummy.scale.set(length, 1, 1);
        dummy.updateMatrix();
        band.setMatrixAt(index, dummy.matrix);
        index++;
      }
    }
    band.count = index;
    group.add(band);
  }

  // Add a modest cornice at the roof line for larger buildings.
  if (height > 9 && box.getSize(new THREE.Vector2()).length() > 12) {
    const cornice = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.22, 0.20), trimMaterial, points.length,
    );
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      dummy.position.set((a.x + b.x) / 2, height - 0.12, -(a.y + b.y) / 2);
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(length, 1, 1);
      dummy.updateMatrix();
      cornice.setMatrixAt(i, dummy.matrix);
    });
    group.add(cornice);
  }
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
  const roofShape = (building.tags['roof:shape'] || (building.tags['building:levels'] ? 'flat' : 'gabled')).toLowerCase();
  const baseStyle = palette[Math.floor(seeded(building.id, 2) * palette.length)];
  const parseOSMColor = (value: string | undefined, fallback: THREE.ColorRepresentation): THREE.ColorRepresentation => {
    if (!value) return fallback;
    const candidate = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(candidate) || /^[a-z]+$/i.test(candidate)) return candidate;
    return fallback;
  };
  const style: BuildingStyle = {
    wall: parseOSMColor(building.tags['building:colour'] || building.tags['building:color'], baseStyle.wall),
    roof: parseOSMColor(building.tags['roof:colour'] || building.tags['roof:color'], baseStyle.roof),
    trim: baseStyle.trim,
    glass: baseStyle.glass,
  };
  const group = new THREE.Group();

  const wallGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  wallGeometry.rotateX(-Math.PI / 2);
  const walls = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({
    color: style.wall, roughness: 0.92, metalness: 0,
  }));
  group.add(walls);

  const roofMaterial = new THREE.MeshStandardMaterial({ color: style.roof, roughness: 0.88 });
  const roofWidth = Math.min(box.max.x - box.min.x, box.max.y - box.min.y);
  const roofHeight = roofShape === 'flat' ? 0
    : clamp(roofWidth * (roofShape === 'hipped' ? 0.16 : 0.22), 0.7, 4.5);
  group.add(makeRoof(points, height, roofHeight, roofShape, roofMaterial));

  addFacadeDetails(group, points, box, height, style, building.id, building.tags);

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

export interface OSMRoad {
  id: number;
  coordinates: [number, number][];
  tags: Record<string, string>;
}

/** Create a lightweight road ribbon from the real OSM centerline. */
export function buildRoadMesh(
  road: OSMRoad,
  project: (lng: number, lat: number) => THREE.Vector2,
): THREE.Mesh | null {
  if (road.coordinates.length < 2) return null;
  const highway = road.tags.highway || 'road';
  const widths: Record<string, number> = {
    motorway: 13, trunk: 11, primary: 9, secondary: 7.5,
    tertiary: 6, residential: 5, unclassified: 4.5,
    living_street: 4, service: 3.2, pedestrian: 3.5,
    footway: 1.6, path: 1.2, cycleway: 1.8,
  };
  const width = widths[highway] ?? 4;
  const points = road.coordinates.map(([lng, lat]) => project(lng, lat));
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = -(b.y - a.y);
    const length = Math.hypot(dx, dz);
    if (length < 0.25) continue;
    const nx = -dz / length * width * 0.5;
    const nz = dx / length * width * 0.5;
    const base = positions.length / 3;
    positions.push(
      a.x + nx, 0.055, -a.y + nz,
      a.x - nx, 0.055, -a.y - nz,
      b.x + nx, 0.055, -b.y + nz,
      b.x - nx, 0.055, -b.y - nz,
    );
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const color = highway === 'motorway' || highway === 'trunk' ? '#777b80'
    : highway === 'primary' || highway === 'secondary' ? '#8b8983'
    : highway === 'pedestrian' || highway === 'footway' || highway === 'path' ? '#b5ad9c'
    : '#a19d94';
  const material = new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { osmRoad: road.id, highway };
  return mesh;
}
