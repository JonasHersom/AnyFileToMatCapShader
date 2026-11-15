// Responsibility: the DOM. Finds the elements of index.html and turns them into a small API
// (status line, fps counter, model list, model upload). It knows nothing about WebGPU.

const UPLOAD_ID = '__upload__';

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no element with id "${id}".`);
  return element;
}

export function createUi() {
  const canvas = byId('canvas');
  const statusBar = byId('status-bar');
  const fpsLabel = byId('fps-counter');
  const modelSelect = byId('model-select');
  const uploadButton = byId('model-upload-btn');
  const fileInput = byId('model-file-input');

  // ---- status line ----
  let hideTimer = 0;
  const status = {
    show(text, { error = false, hideAfterMs = 0 } = {}) {
      clearTimeout(hideTimer);
      statusBar.textContent = text;
      statusBar.classList.remove('hidden');
      statusBar.classList.toggle('is-error', error);
      if (hideAfterMs > 0) hideTimer = setTimeout(status.hide, hideAfterMs);
    },
    error(text) { status.show(text, { error: true }); },
    hide() { statusBar.classList.add('hidden'); },
  };

  // ---- fps counter: call tick(dt) every frame, the label updates twice a second ----
  let frames = 0;
  let elapsed = 0;
  const fps = {
    tick(dt) {
      frames++;
      elapsed += dt;
      if (elapsed < 0.5) return;
      fpsLabel.textContent = `${Math.round(frames / elapsed)} fps`;
      frames = 0;
      elapsed = 0;
    },
  };

  // ---- model list and upload ----
  return {
    canvas,
    status,
    fps,
    UPLOAD_ID,

    setModels(models) {
      modelSelect.replaceChildren(...models.map(({ id, name }) => new Option(name, id)));
    },

    selectModel(id) { modelSelect.value = id; },

    // adds (or renames) the entry for the file the user uploaded and selects it
    setUploadedModel(fileName) {
      let option = [...modelSelect.options].find(o => o.value === UPLOAD_ID);
      if (!option) {
        option = new Option('', UPLOAD_ID);
        modelSelect.append(option);
      }
      option.textContent = `Uploaded: ${fileName}`;
      modelSelect.value = UPLOAD_ID;
    },

    onModelChosen(callback) {
      modelSelect.addEventListener('change', () => callback(modelSelect.value));
    },

    onModelFile(callback) {
      uploadButton.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        fileInput.value = '';   // so that choosing the same file again fires another change event
        if (file) callback(file);
      });
    },
  };
}
