export class SplatViewer {
  constructor(root) {
    this.root = root;
  }
  async load(url) {
    const { Viewer, SceneFormat } = await import(
      "/static/vendor/gaussian-splats.js"
    );
    if (this.disposed) return;
    this.viewer = new Viewer({
      rootElement: this.root,
      cameraUp: [0, -1, 0],
      initialCameraPosition: [0, -1, 4],
      initialCameraLookAt: [0, 0, 0],
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
    });
    await this.viewer.addSplatScene(url, {
      format: SceneFormat.Ply,
      showLoadingUI: true,
    });
    if (!this.disposed) this.viewer.start();
  }
  reset() {
    this.viewer?.camera.position.set(0, -1, 4);
    this.viewer?.controls.target.set(0, 0, 0);
    this.viewer?.controls.update();
  }
  dispose() {
    this.disposed = true;
    this.viewer?.dispose();
  }
}
