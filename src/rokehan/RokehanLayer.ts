import * as THREE from 'three';
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { buildBuildingMesh, buildTreeMesh, type OSMBuilding, type OSMTree } from './geometry';
import { fetchOSMViewport, type OSMViewportData } from './osm';

const EARTH_CIRCUMFERENCE = 40075016.68557849;

export class RokehanLayer implements CustomLayerInterface {
  id = 'aytar-rokehan-geometry';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private map: MapLibreMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private requestController: AbortController | null = null;
  private requestKey = '';
  private disposed = false;
  private light = new THREE.HemisphereLight(0xfff3df, 0x77705e, 2.0);
  private onMoveEnd = () => { void this.loadVisibleArea(); };

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.scene.add(this.light);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-0.4, 1, 0.6);
    this.scene.add(sun);
    this.root.rotation.x = Math.PI / 2;
    this.scene.add(this.root);
    map.on('moveend', this.onMoveEnd);
    map.on('zoomend', this.onMoveEnd);
    void this.loadVisibleArea();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: number[]) {
    if (!this.renderer) return;
    this.camera.projectionMatrix.fromArray(matrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map?.triggerRepaint();
  }

  onRemove() {
    this.disposed = true;
    this.map?.off('moveend', this.onMoveEnd);
    this.map?.off('zoomend', this.onMoveEnd);
    this.requestController?.abort();
    this.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose());
      else if (mesh.material) mesh.material.dispose();
    });
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  async loadVisibleArea() {
    const map = this.map;
    if (!map || this.disposed || map.getZoom() < 14.2) return;
    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast(),
    ];
    const key = bbox.map(value => value.toFixed(4)).join(',');
    if (key === this.requestKey) return;
    this.requestKey = key;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;

    try {
      const data = await fetchOSMViewport(bbox, controller.signal);
      if (controller.signal.aborted || this.disposed || this.map !== map) return;
      this.replaceGeometry(data);
      map.triggerRepaint();
      console.info('[AYTAR Rokehan] OSM geometry loaded', {
        buildings: data.buildings.length,
        trees: data.trees.length,
        roads: data.roads.length,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('[AYTAR Rokehan] OSM data unavailable:', error);
        this.requestKey = '';
      }
    }
  }

  private replaceGeometry(data: OSMViewportData) {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose());
        else if (mesh.material) mesh.material.dispose();
      });
    }

    const centerLng = (data.bbox[1] + data.bbox[3]) / 2;
    const centerLat = (data.bbox[0] + data.bbox[2]) / 2;
    const centerMercator = maplibreMercator(centerLng, centerLat);
    const metersPerMercator = EARTH_CIRCUMFERENCE * Math.cos(centerLat * Math.PI / 180);
    const project = (lng: number, lat: number) => new THREE.Vector2(
      (lng - centerLng) * Math.PI / 180 * 6378137 * Math.cos(centerLat * Math.PI / 180),
      (lat - centerLat) * Math.PI / 180 * 6378137,
    );

    const buildings = data.buildings as OSMBuilding[];
    for (const building of buildings) {
      const mesh = buildBuildingMesh(building, project);
      if (mesh) this.root.add(mesh);
    }

    const trees = data.trees as OSMTree[];
    for (const tree of trees) this.root.add(buildTreeMesh(tree, project));

    // Three.js geometry is authored in meters; MapLibre's world coordinates are normalized Mercator.
    this.root.position.set(centerMercator.x, centerMercator.y, 0);
    this.root.scale.setScalar(1 / metersPerMercator);
  }
}

function maplibreMercator(lng: number, lat: number) {
  const x = (lng + 180) / 360;
  const sin = Math.sin(lat * Math.PI / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return new THREE.Vector2(x, y);
}
