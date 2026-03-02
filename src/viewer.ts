/**
 * Standalone STL Viewer — no Obsidian dependency.
 * Compiled and inlined into stl-viewer.html by the build script.
 *
 * Supports:
 *   ?src=<url>               auto-loads on open; GitHub blob URLs are auto-converted
 *   drag-and-drop            drop anywhere on the page
 *   click-to-browse          click the drop zone
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── URL normalisation ─────────────────────────────────────────────────────────
// Converts GitHub blob page URLs to raw content URLs so fetch() gets binary data.
// https://github.com/owner/repo/blob/REF/path  →  https://raw.githubusercontent.com/owner/repo/REF/path

function normaliseUrl(url: string): string {
  return url.replace(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
    'https://raw.githubusercontent.com/$1/',
  );
}

// ── Viewer class ─────────────────────────────────────────────────────────────

class STLViewer {
  private renderer:  THREE.WebGLRenderer;
  private scene:     THREE.Scene;
  private camera:    THREE.PerspectiveCamera;
  private controls:  OrbitControls;
  private lights:    THREE.Light[] = [];
  private mesh:      THREE.Mesh | null = null;

  constructor(private container: HTMLElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x18181b);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const key     = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 4);
    const fill    = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-3, 0, -2);
    this.lights   = [ambient, key, fill];
    this.scene.add(...this.lights);

    // Camera
    const w = container.clientWidth  || 800;
    const h = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100_000);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping     = true;
    this.controls.dampingFactor     = 0.08;
    this.controls.screenSpacePanning = true;

    // Resize — anonymous observer is acceptable for a page-lifetime standalone viewer.
    new ResizeObserver(() => {
      const rw = container.clientWidth;
      const rh = container.clientHeight;
      if (!rw || !rh) return;
      this.camera.aspect = rw / rh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(rw, rh);
    }).observe(container);

    // Animate — loop lives for the page lifetime of the standalone viewer.
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  loadBuffer(buffer: ArrayBuffer, filename: string): void {
    // Remove any previously loaded mesh (keep lights); dispose GPU resources.
    const toRemove = this.scene.children.filter(c => !(c instanceof THREE.Light));
    toRemove.forEach(c => {
      this.scene.remove(c);
      const mesh = c as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mat = mesh.material;
        if (Array.isArray(mat)) { mat.forEach(m => m.dispose()); }
        else { mat.dispose(); }
      }
    });

    const geometry = new STLLoader().parse(buffer);
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    if (!geometry.boundingBox) {
      setStatus('Error: could not read STL geometry.', true);
      return;
    }

    const box    = geometry.boundingBox;
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    geometry.translate(-center.x, -center.y, -center.z);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshPhongMaterial({
        color:     0x2e74b5,
        specular:  0x444444,
        shininess: 60,
        side:      THREE.DoubleSide,
      }),
    );
    this.scene.add(mesh);
    this.mesh = mesh;

    // Frame camera
    this.camera.near = maxDim * 0.001;
    this.camera.far  = maxDim * 100;
    this.camera.position.set(0, maxDim * 0.5, maxDim * 2.2);
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Triangle count: non-indexed STL → position.count / 3; indexed → index.count / 3.
    const triangleCount = geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;

    setOverlay(filename, size, triangleCount);
  }

  toggleWireframe(): boolean {
    if (!this.mesh) return false;
    const mat = this.mesh.material as THREE.MeshPhongMaterial;
    mat.wireframe = !mat.wireframe;
    return mat.wireframe;
  }

  async loadUrl(url: string): Promise<void> {
    const raw = normaliseUrl(url);
    let resp: Response;
    try {
      resp = await fetch(raw);
    } catch {
      // fetch() throws TypeError on network/CORS errors — give a useful hint.
      throw new Error(
        raw !== url
          ? `Failed to fetch (converted to raw URL: ${raw})`
          : `Failed to fetch — the server may not allow cross-origin requests`,
      );
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${raw}`);
    const buf = await resp.arrayBuffer();
    this.loadBuffer(buf, raw.split('/').pop() ?? raw);
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────

function setOverlay(name: string, size: THREE.Vector3, tris: number): void {
  const el = document.getElementById('overlay');
  if (!el) return;
  const f = (n: number) => n.toFixed(2);
  el.textContent = `${name}\n${f(size.x)} × ${f(size.y)} × ${f(size.z)}\n${tris.toLocaleString()} triangles`;
  (el as HTMLElement).style.display = 'block';
}

function setStatus(msg: string, isError = false): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent  = msg;
  (el as HTMLElement).style.color   = isError ? '#f87171' : '#9ca3af';
  (el as HTMLElement).style.display = 'block';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  const container    = document.getElementById('viewer')        as HTMLDivElement;
  const dropZone     = document.getElementById('drop-zone')     as HTMLDivElement;
  const toolbar      = document.getElementById('toolbar')       as HTMLDivElement;
  const btnWireframe = document.getElementById('btn-wireframe') as HTMLButtonElement;

  // Initialise viewer — catch WebGL / context-creation errors immediately so the
  // rest of the page (drop zone, error messages) still works if 3-D fails.
  let viewer: STLViewer;
  try {
    viewer = new STLViewer(container);
  } catch (e: any) {
    setStatus(`3D viewer failed to initialise: ${e?.message ?? e}`, true);
    return;
  }

  function onModelLoaded() {
    dropZone.style.display = 'none';
    toolbar.style.display  = 'flex';
  }

  // ── Wireframe button + keyboard shortcut ─────────────────────────────────
  btnWireframe.addEventListener('click', () => {
    btnWireframe.classList.toggle('active', viewer.toggleWireframe());
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'w' || e.key === 'W') {
      btnWireframe.classList.toggle('active', viewer.toggleWireframe());
    }
  });

  // ── ?src= parameter: fetch STL from URL ──────────────────────────────────
  const srcParam = new URLSearchParams(location.search).get('src');
  if (srcParam) {
    setStatus('Loading…');
    viewer.loadUrl(srcParam)
      .then(() => {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.style.display = 'none';
        onModelLoaded();
      })
      .catch(e => setStatus(`Error: ${e.message}`, true));
  }

  // ── Click-to-browse ───────────────────────────────────────────────────────
  dropZone.addEventListener('click', () => {
    const inp    = document.createElement('input');
    inp.type     = 'file';
    inp.accept   = '.stl';
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      file.arrayBuffer().then(buf => { viewer.loadBuffer(buf, file.name); onModelLoaded(); });
    };
    inp.click();
  });

  // ── Drag-and-drop — listen at document level so the Three.js canvas
  //    never blocks drops regardless of stacking / pointer-event state.
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.stl')) return;
    file.arrayBuffer().then(buf => { viewer.loadBuffer(buf, file.name); onModelLoaded(); });
  });
});
