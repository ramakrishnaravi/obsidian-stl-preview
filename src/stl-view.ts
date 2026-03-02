import { FileView, WorkspaceLeaf, TFile } from 'obsidian';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type STLPreviewPlugin from './main';

export const VIEW_TYPE = 'stl-preview';

export class STLView extends FileView {
  private plugin:      STLPreviewPlugin;
  private renderer:    THREE.WebGLRenderer      | null = null;
  private controls:    OrbitControls             | null = null;
  private rafId:       number                    | null = null;
  private resizeObs:   ResizeObserver            | null = null;
  private scene:       THREE.Scene               | null = null;
  private mesh:        THREE.Mesh                | null = null;
  private grid:        THREE.GridHelper          | null = null;
  private camera:      THREE.PerspectiveCamera   | null = null;
  // Abort token: incremented by teardown() to cancel any in-flight renderSTL().
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, plugin: STLPreviewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return this.file?.name ?? 'STL Preview'; }
  getIcon()        { return 'box'; }

  async onOpen(): Promise<void> {
    // Toolbar buttons
    this.addAction('home',  'Reset camera',      () => this.resetCamera());
    this.addAction('grid',  'Toggle floor grid',  () => this.toggleGrid());
    this.addAction('eye',   'Toggle wireframe',   () => this.toggleWireframe());

    // React to settings changes (e.g. from the settings tab)
    // Cast needed because Obsidian's workspace.on() typings don't include custom events.
    this.registerEvent(
      (this.app.workspace as any).on('stl-preview:settings-changed', () => this.applySettings()),
    );
  }

  // Called by Obsidian when the user opens an .stl file
  async onLoadFile(file: TFile): Promise<void> {
    await this.renderSTL(file);
  }

  // Called when the view is closed or another file replaces this one
  async onUnloadFile(_file: TFile): Promise<void> {
    this.teardown();
  }

  async onClose(): Promise<void> {
    this.teardown();
  }

  // ── Renderer ───────────────────────────────────────────────────────────────

  private async renderSTL(file: TFile): Promise<void> {
    // teardown() increments renderToken, cancelling any prior in-flight render.
    this.teardown();
    // Claim a render slot AFTER teardown so external teardowns can still cancel us.
    const token = ++this.renderToken;

    const el = this.contentEl;
    el.empty();
    el.setCssStyles({ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' });

    const spinner = el.createDiv({ cls: 'stl-loading' });
    spinner.setText('Loading…');

    // ── Load STL (only await in this function) ──
    const buffer = await this.app.vault.readBinary(file);
    // Abort if the view was closed or a new file was opened while we were awaiting.
    if (this.renderToken !== token) return;

    const { backgroundColor, modelColor, showGrid } = this.plugin.settings;

    // ── Scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    this.scene = scene;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-3, 0, -2);
    scene.add(fill);

    // ── Camera ──
    const w = el.clientWidth  || 800;
    const h = el.clientHeight || 600;
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100_000);
    this.camera = camera;

    // ── WebGL Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    this.renderer = renderer;

    // ── Controls ──
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping     = true;
    controls.dampingFactor     = 0.08;
    controls.screenSpacePanning = true;
    this.controls = controls;

    // ── Parse STL ──
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    if (!geometry.boundingBox) {
      spinner.remove();
      el.createDiv({ cls: 'stl-overlay' }).setText('Error: could not read STL geometry.');
      return;
    }

    const box    = geometry.boundingBox;
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    geometry.translate(-center.x, -center.y, -center.z);

    const material = new THREE.MeshPhongMaterial({
      color:     new THREE.Color(modelColor),
      specular:  0x444444,
      shininess: 60,
      side:      THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    this.mesh = mesh;

    // ── Floor grid ──
    const gridSize = maxDim * 3;
    const grid = new THREE.GridHelper(gridSize, 20, 0x444444, 0x333333);
    grid.position.y = -size.y / 2;
    grid.visible = showGrid;
    scene.add(grid);
    this.grid = grid;

    // ── Camera framing ──
    camera.position.set(0, maxDim * 0.5, maxDim * 2.2);
    camera.near = maxDim * 0.001;
    camera.far  = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.update();

    // ── Resize handling ──
    this.resizeObs = new ResizeObserver(() => {
      const rw = el.clientWidth;
      const rh = el.clientHeight;
      if (rw === 0 || rh === 0) return;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
    });
    this.resizeObs.observe(el);

    // ── Render loop ──
    const animate = () => {
      this.rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    spinner.remove();

    // Triangle count: non-indexed STL has position.count/3 triangles;
    // for indexed geometry use index.count/3 instead.
    const triangleCount = geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;

    this.addOverlay(el, file.name, size, triangleCount);
  }

  // ── Apply settings without full re-render ─────────────────────────────────
  // Called from the settings-changed workspace event (must be public for event registration).

  applySettings(): void {
    if (!this.scene) return;
    const { backgroundColor, modelColor, showGrid } = this.plugin.settings;

    this.scene.background = new THREE.Color(backgroundColor);

    if (this.mesh) {
      (this.mesh.material as THREE.MeshPhongMaterial).color.set(modelColor);
    }

    if (this.grid) {
      this.grid.visible = showGrid;
    }
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  private resetCamera(): void {
    if (!this.file) return;
    this.renderSTL(this.file).catch(e => console.error('STL Preview: reload failed', e));
  }

  private toggleGrid(): void {
    if (!this.grid) return;
    this.grid.visible = !this.grid.visible;
  }

  private toggleWireframe(): void {
    if (!this.mesh) return;
    const mat = this.mesh.material as THREE.MeshPhongMaterial;
    mat.wireframe = !mat.wireframe;
  }

  // ── Info overlay (top-left) ───────────────────────────────────────────────

  private addOverlay(
    el: HTMLElement,
    name: string,
    size: THREE.Vector3,
    triangles: number,
  ): void {
    const ov = el.createDiv({ cls: 'stl-overlay' });
    const fmt = (n: number) => n.toFixed(2);
    ov.setText(
      `${name}\n` +
      `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} mm\n` +
      `${triangles.toLocaleString()} triangles`,
    );
    ov.style.whiteSpace = 'pre';
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private teardown(): void {
    // Invalidate any in-flight renderSTL() by bumping the abort token.
    this.renderToken++;

    if (this.rafId     !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.resizeObs !== null) { this.resizeObs.disconnect(); this.resizeObs = null; }
    if (this.controls  !== null) { this.controls.dispose();  this.controls = null; }

    if (this.mesh !== null) {
      this.mesh.geometry.dispose();
      const mat = this.mesh.material;
      if (Array.isArray(mat)) { mat.forEach(m => m.dispose()); }
      else { mat.dispose(); }
      this.mesh = null;
    }

    if (this.grid !== null) {
      // GridHelper extends LineSegments — geometry and material are always present.
      const ls = this.grid as unknown as THREE.LineSegments;
      ls.geometry.dispose();
      const mat = ls.material;
      if (Array.isArray(mat)) { mat.forEach(m => m.dispose()); }
      else { mat.dispose(); }
      this.grid = null;
    }

    if (this.scene !== null) {
      // Remove all children (lights, any residual objects) and release references.
      this.scene.clear();
      this.scene = null;
    }

    if (this.renderer !== null) { this.renderer.dispose(); this.renderer = null; }
    this.camera = null;
    this.contentEl.empty();
  }
}
