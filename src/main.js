import { initWebGPU, resizeCanvasToDisplaySize } from './gpu/device.js';
import { createRenderer } from './renderer/renderer.js';
import { createFirstPersonInput } from './input/firstPersonInput.js';
import { createFlyCamera } from './camera/flyCamera.js';
import { loadObjFromUrl, loadObjFromFile } from './model/objLoader.js';
import { createSphereMesh } from './model/primitives.js';
import { uploadMesh } from './model/gpuMesh.js';
import { MODELS } from './models.js';
import { createUi } from './ui/panel.js';

const FLY_HINT = 'Click the canvas to fly: mouse to look, W A S D to move, Space / Shift for up / down, Esc to release.';

async function main() {
  const ui = createUi();

  let gpu;
  try {
    gpu = await initWebGPU(ui.canvas);
  } catch (error) {
    ui.status.error(error.message);
    return;
  }
  const { device } = gpu;

  const renderer = createRenderer({ ...gpu, canvas: ui.canvas });
  const input = createFirstPersonInput(ui.canvas);
  const camera = createFlyCamera(input);

  // showing a model 
  let currentModelId = null;
  let uploaded = null;   // the last uploaded model { name, mesh }, so it can be selected again
  let latestRequest = 0;

  // Loads a mesh and shows it. Returns the mesh, or null if loading failed or a newer request
  // replaced this one (the user clicked on another model while this one was still loading).
  async function showModel(label, loadMesh) {
    const request = ++latestRequest;
    ui.status.show(`Loading ${label}…`);
    try {
      const mesh = await loadMesh();
      if (request !== latestRequest) return null;
      renderer.setMesh(uploadMesh(device, mesh));
      camera.reset();
      ui.status.show(`${label}: ${mesh.indices.length / 3} triangles. ${FLY_HINT}`, { hideAfterMs: 8000 });
      return mesh;
    } catch (error) {
      if (request === latestRequest) ui.status.error(`Could not load ${label}: ${error.message}`);
      return null;
    }
  }

  const loadBuiltIn = (model) => model.builtin === 'sphere' ? createSphereMesh() : loadObjFromUrl(model.url);

  async function chooseModel(id) {
    const model = MODELS.find(m => m.id === id);
    const loaded = id === ui.UPLOAD_ID
      ? await showModel(uploaded.name, () => uploaded.mesh)
      : await showModel(model.name, () => loadBuiltIn(model));
    if (loaded) currentModelId = id;
    else ui.selectModel(currentModelId);   // loading failed: the select shows what is on screen
  }

  ui.setModels(MODELS);
  ui.onModelChosen(chooseModel);
  ui.onModelFile(async (file) => {
    const mesh = await showModel(file.name, () => loadObjFromFile(file));
    if (!mesh) return;
    uploaded = { name: file.name, mesh };
    currentModelId = ui.UPLOAD_ID;
    ui.setUploadedModel(file.name);
  });

  ui.selectModel(MODELS[0].id);
  await chooseModel(MODELS[0].id);

  // frame loop 
  let last = null;   // the first frame has no previous frame, so its dt is 0
  function frame(now) {
    const dt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;

    if (resizeCanvasToDisplaySize(ui.canvas)) renderer.resize();
    camera.update(dt);
    renderer.render(camera.viewMatrix(), camera.eye);
    ui.fps.tick(dt);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
