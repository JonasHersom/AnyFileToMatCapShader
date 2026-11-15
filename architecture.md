# AnyFileToMatCapShader – Architecture

**What it is:** one web page, mostly a 3D view. The object is shaded with a MatCap. The user picks a default MatCap, or uploads *any file*. The file is converted to an image (p2r3/convert), the image is wrapped around a sphere, and the "picture of that sphere" becomes the MatCap.

**Course:** 02561 Computer Graphics. Group of 2. Same stack as the worksheets (HTML, CSS, JS, WebGPU/WGSL, the course helpers). Kept deliberately small.

---

## 1. Scope

**In v1**

- 3D view, full viewport, first-person camera (WASD + mouse, as in worksheet 11).
- Built-in models (`public/models/*.obj`) and a built-in sphere. Upload a model: `.obj` directly, other formats through convert → OBJ.
- Built-in MatCaps (`public/matcaps/*.png`, open-source licensed) shown as clickable thumbnails.
- Upload any file convert can turn into an image → MatCap. Controls: blur, light direction, Phong sliders (worksheet 4/5).
- Status line, error messages, preview of the converted image.

**Cut (on purpose)**

- Compute shaders, "lighting analysis", Sobel light detection, the `hybrid` mode. See §5.2 for the simpler replacement.
- three.js / glTF. OBJ only.
- Raw-bytes fallback for files convert cannot handle: they just give an error message.
- Export button, MSAA, auto-rotate, background options, shadows/real lights.

**Stretch (only if time is left):** flat and mirror-ball mapping modes, cover vs. stretch aspect, MatCap PNG export.

---

## 2. Stack and build

| Thing | Choice | Why |
|---|---|---|
| Language | JavaScript ES modules (+ JSDoc where useful) | Same as the worksheets |
| Graphics | WebGPU + WGSL | Same as the worksheets |
| Build | **Vite + Bun**, run locally. `bun run build` → static `dist/` folder | convert needs Vite/Bun/TypeScript. The DTU server only gets `dist/`, nothing is installed there |
| Hosting | Static files on the DTU student server | `base: './'` in `vite.config.js` so the site works under `~username/…` |
| Shaders | `import code from './x.wgsl?raw'` | No `fetch` and no path problems after deployment |
| Course helpers | `MV.js`, `genmipmap.js`, `OBJParser.js` as **classic `<script>` tags**, `webgpu-utils.js` as an ES module (`src/gpu.js`) | They are written that way (they use globals). Copying them unchanged keeps worksheet code (camera, shaders) portable |
| HTTP headers | Available on the host | Only needed if convert's ffmpeg wants cross-origin isolation (check in the spike) |

`index.html` lives in the **project root** (Vite convention):

```html
<script src="./lib/MV.js"></script>
<script src="./lib/genmipmap.js"></script>
<script src="./lib/OBJParser.js"></script>
<script type="module" src="/src/main.js"></script>
```

The three classic scripts live untouched in `public/lib/`. Vite will warn that it leaves them as they are; that is what we want. Classic scripts run before the module, so the globals (`vec3`, `mat4`, `generateMipmap`, `readOBJFile`, …) exist when our modules start.

---

## 3. Data flow

```
 public/matcaps/*.png ──────────── createImageTexture ───────────────┐
                                                                     ▼
 user file ─► imageSource ─► ImageBitmap ─► matcap generator ─► GPUTexture (MatCap) ─► renderer ─► canvas
   (image: fast path;                       (1 render pass                                 ▲   ▲
    else convert → PNG)                      + mipmaps)                                    │   │
                                                                                           │   │
 public/models/*.obj ─────────┐                                                            │   │
 user model ─► (convert → OBJ)┴─► loadModel (smooth normals) ─► ModelData ─────────────────┘   │
                                                                                               │
 mouse + WASD ─► camera (from worksheet 11) ─► view matrix ────────────────────────────────────┘
```

Rules that keep the modules independent:

- The generator takes an **`ImageBitmap`**, not convert's `FileData`. Convert is just one way of *getting* an image.
- The generator returns a **`GPUTexture`**. It knows nothing about the renderer's bind groups.
- Only **one file** (`convertAdapter.js`) imports from `src/convert/`.
- `main.js` owns all app state. No module reaches into another module's state.

---

## 4. Repo layout

```
index.html
vite.config.js
package.json
public/
  lib/            MV.js  genmipmap.js  OBJParser.js      (untouched course files)
  models/         *.obj
  matcaps/        *.png  *.jpg                           
src/
  main.js                     state, wiring, render loop
  style.css                   own layout (see §6)
  gpu.js                      trimmed webgpu-utils.js
  models.js  matcaps.js       the lists of built-in models / MatCaps (name + url)
  convert/                    git subtree of p2r3/convert – NEVER edited by us
  imageSource/
    convertAdapter.js         the only importer of ./convert  → convertFile(file, 'png' | 'obj')
    toImage.js                fileToImage(file)  → ImageBitmap
    toObj.js                  fileToObjText(file) → string
  matcap/
    generateMatCap.js         createMatCapGenerator(device)
    matcapGenerate.wgsl
  renderer/
    Renderer.js               createRenderer(...)
    loadModel.js              OBJ → buffers with smooth normals, built-in sphere
    Camera.js                 port of worksheet 11 part 3
    matcap.wgsl
  ui/
    panel.js                  sidebar: model select, MatCap thumbnails, sliders, upload buttons, status
```

There is no `shader/` module, no `types.js` files and no class hierarchy. Each folder is a few functions, and the contracts are in §5.

---

## 5. Modules

### 5.1 imageSource (file → image / OBJ)

```js
/** Any file → ImageBitmap (max 2048 px on the long side). */
export async function fileToImage(file) {}

/** .obj → text directly; other 3D files → convert → OBJ text. */
export async function fileToObjText(file) {}

/** The ONLY place that touches ./convert. Returns convert's FileData (name + bytes). */
export async function convertFile(file, targetExt /* 'png' | 'obj' */) {}
```

`fileToImage`:

1. If the browser can decode it (png, jpg, webp, gif, bmp, avif): `createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`. **No converter needed.** These options match what `createImageTexture` in the helpers does.
2. Otherwise: `const { convertFile } = await import('./convertAdapter.js')`. This is a **lazy import**, so the converter and its WASM are only loaded when needed.
3. Make a `Blob` from the PNG bytes, `createImageBitmap`, downscale to ≤ 2048 px if bigger (`resizeWidth/resizeHeight`).
4. Also keep the PNG `Blob` URL for the preview `<img>` in the panel.

Limits: reject files above a size limit (pick one, e.g. 100 MB) before converting.

### 5.2 matcap (ImageBitmap → MatCap texture)

A MatCap is literally a picture of a lit sphere seen from the front. So the generator is **one render pass** into a 512×512 texture (the "textured globe" of worksheet 6 and the Phong shading of worksheet 4/5, on an analytic sphere instead of a mesh), followed by `generateMipmap`.

```js
export function createMatCapGenerator(device, size = 512) {
  // owns ONE output texture (rgba8unorm, full mip chain, RENDER_ATTACHMENT | TEXTURE_BINDING)
  return {
    texture,                     // stable object: the renderer binds it once
    setSource(bitmap) {},        // uploads the image (with mips) and remembers it
    render(params) {},           // redraws `texture` in place + generateMipmap(device, texture)
  };
}
// params: { blur, lightAzimuth, lightElevation, kd, ks, shininess, La, Le }   (all numbers)
```

Because `texture` never changes, moving a slider is just `render(params)`. The renderer's bind group is not touched. One 512² draw is cheap, so no debouncing is needed.

**Layers (each one is a slider):**

1. **Wrap.** The visible half of a sphere is covered with the *whole* image (longitude −90°…90° → u, latitude −90°…90° → v). Only the front hemisphere is ever visible, so there is no seam and no `atan2` discontinuity.
2. **Smooth.** `textureSampleLevel` on the source's mip chain, with `lod = blur * (mipCount - 1)`. This is free blur and needs no extra pass.
3. **Light.** Phong with the worksheet sliders: `La`, `kd`, `ks`, `shininess`, `Le`. This is the important layer: a plain wrapped image has colour but no sense of form (e.g. a mostly white PDF page). The lighting gives the MatCap its shape.
4. **Edge.** Pixels outside the disc use the rim normal, so the texture is extended radially. Linear filtering at the silhouette then never blends in black.

```wgsl
// matcapGenerate.wgsl
struct Params {
  light: vec4f,                       // xyz: direction towards the light, view space
  kd: f32, ks: f32, shininess: f32, La: f32,
  Le: f32, lod: f32, pad0: f32, pad1: f32,
}                                      // 48 bytes -> createUniformBuffer(device, 12)
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;      // linear, mipmapFilter linear, clamp-to-edge

struct VSOut { @builtin(position) pos: vec4f, @location(0) xy: vec2f }

@vertex fn main_vs(@builtin(vertex_index) i: u32) -> VSOut {
  let c = array<vec2f, 4>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));  // triangle-strip, like genmipmap.js
  var o: VSOut;
  o.pos = vec4f(c[i], 0.0, 1.0);
  o.xy = c[i];                          // y points up
  return o;
}

const PI = 3.14159265;

@fragment fn main_fs(in: VSOut) -> @location(0) vec4f {
  var xy = in.xy;
  let r2 = dot(xy, xy);
  if (r2 > 1.0) { xy = xy / sqrt(r2); }                         // edge extension
  let n = vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));         // sphere normal, +z towards the viewer

  let lon = atan2(n.x, n.z);                                    // -pi/2 .. pi/2 on the front
  let lat = asin(clamp(n.y, -1.0, 1.0));
  let uv  = vec2f(lon / PI + 0.5, 0.5 - lat / PI);              // v = 0 is the top row
  let s   = textureSampleLevel(src, samp, uv, p.lod);
  let albedo = mix(vec3f(1.0), s.rgb, s.a);                     // transparent pixels (svg, png) -> white, not black

  let l = normalize(p.light.xyz);
  let h = normalize(l + vec3f(0.0, 0.0, 1.0));                  // the eye is at +z in view space
  let diffuse  = max(dot(n, l), 0.0);
  let specular = pow(max(dot(n, h), 0.0), p.shininess);
  let color = (albedo * (p.La + p.kd * diffuse) + vec3f(p.ks * specular)) * p.Le;
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
```

Known look: with the poles on the y axis, the top and bottom rows of the image pinch to a point at the top and bottom of the disc. That is expected for a lat-long wrap.

Colour space: everything stays non-sRGB (`rgba8unorm` textures, helper canvas format, `colorSpaceConversion: 'none'`). That is consistent with the worksheets. Don't mix in `-srgb` formats or the image will come out brighter.

### 5.3 renderer (model + MatCap → canvas)

```js
export function createRenderer({ canvas, device, context, canvasFormat }) {
  return {
    setModel(modelData) {},      // see loadModel.js
    setMatCap(texture) {},       // rebuilds the bind group (cheap)
    resize() {},                 // canvas pixel size + new depth texture (ResizeObserver in main.js)
    render(viewMatrix) {},       // writes the uniforms, draws, submits
  };
}
```

- One pipeline: `createPipeline(device, { shader, buffers: [POS_NORMAL_LAYOUT], format: canvasFormat, cull: 'none', depth: true })`.
- One uniform buffer (`createUniformBuffer(device, 48)`): `mvp`, `modelView`, `normalMat = normalMatrix(modelView)` (MV.js, mat4 inverse-transpose), each uploaded with `flatten(...)`.
- Bind group: uniform, MatCap texture view, sampler (linear, mipmapFilter linear, clamp-to-edge).
- Depth: `createDepthTexture`; `beginFrame(device, context, { clear, depthTexture })`.
- Draw: `drawIndexed` if the model has an index buffer, else `draw(vertexCount)` (the built-in sphere is non-indexed).

```wgsl
// matcap.wgsl
struct Uniforms { mvp: mat4x4f, modelView: mat4x4f, normalMat: mat4x4f }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var matcap: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) nView: vec3f,
  @location(1) pView: vec3f,
}

@vertex fn main_vs(@location(0) pos: vec4f, @location(1) nrm: vec4f) -> VSOut {
  var o: VSOut;
  o.pos   = u.mvp * pos;
  o.nView = (u.normalMat * vec4f(nrm.xyz, 0.0)).xyz;      // VIEW space, not world space
  o.pView = (u.modelView * pos).xyz;
  return o;
}

@fragment fn main_fs(in: VSOut) -> @location(0) vec4f {
  var n = normalize(in.nView);                            // re-normalise after interpolation
  if (dot(n, in.pView) > 0.0) { n = -n; }                 // normal faces away from the eye: wrong winding/normals in an uploaded model
  let uv = vec2f(n.x, -n.y) * 0.5 + 0.5;                  // WebGPU v = 0 is the TOP, so flip y
  return vec4f(textureSample(matcap, samp, uv).rgb, 1.0);
}
```

Why view space: the MatCap is glued to the camera. If the normal were in world space, the shading would not follow the camera correctly. No `viewDir`, no `uv` attribute and no reflection vector is needed. A MatCap is not an environment map.

### 5.4 loadModel (OBJ → buffers)

```js
export async function loadObjFromUrl(device, url) {}   // built-in models
export async function loadObjFromText(device, text) {} // uploaded / converted models
export function createSphereModel(device, level = 5) {} // generateSphereWithNormals(level), non-indexed

// ModelData = { vertexBuffer, vertexCount, indexBuffer?, indexCount?, indexFormat?, modelMatrix }
```

Why our own loader instead of `createOBJBuffers` from the helpers:

- **`OBJParser.js` does not smooth normals.** It stores one normal per vertex position. If the file has no `vn`, that is the face normal of the *last* face touching the vertex, so the model looks faceted, which looks bad with a MatCap. We recompute **area-weighted smooth vertex normals** from `vertices` + `indices` (sum the un-normalised face cross products per vertex, then normalise). We always recompute, so there is one code path.
- **`mtllib` breaks uploads.** `OBJParser` fetches the `.mtl` relative to the URL. For a `blob:` URL that fetch rejects and the whole load fails. Strip `mtllib` and `usemtl` lines from the text before parsing. We don't use materials anyway.
- **Size normalisation.** From the bounds (`boundsMin/Max`), `modelMatrix = scalem(s,s,s) · translate(−centre)` with `s = 2 / maxExtent`, so every model fits a [−1, 1]³ box in front of the camera.

Flow for uploads: `text → strip mtllib/usemtl → Blob URL → readOBJFile(url, 1.0, false) → smooth normals → interleave [x y z 1 | nx ny nz 0] → buffers → revoke URL`. The interleaved layout is exactly `POS_NORMAL_LAYOUT`, as `createOBJBuffers` already does.

### 5.5 Camera (worksheet 11)

Port the camera of your worksheet 11 part 3: view direction as two angles, pointer lock on click, WASD + space/shift. `directionFromAngles` and `clamp` already exist in the helpers.

```js
export function createCamera(canvas) {
  return { update(dt) {}, viewMatrix() {}, reset() {} };
}
```

- Start at `(0, 0, 3)` looking down −z.
- Keys only count **while the pointer is locked** (Esc releases it), so typing/dragging in the side panel never moves the camera.
- A "Reset camera" button in the panel.

### 5.6 UI (`panel.js`) and `main.js`

A collapsible panel (`<details>`) on the left over the canvas. Sliders come from `createControls` in the helpers (it exists but is **not exported**; see §6).

```
Model     [ select: Sphere, Bunny, … ]   [Upload model…]
MatCap    [ thumbnail grid of defaults ] [Upload file…]
          status: "Converting… / Generating… / Ready / Error: …"
          <img> preview of the converted image
Generated MatCap only:
          Blur · Light azimuth · Light elevation · kd · ks · shininess · La · Le
          [Reset camera]    hint: "click the canvas, then WASD + mouse, Esc to release"
```

`main.js` holds the state and the only async logic:

```js
const state = { model, matcap: { kind: 'default' | 'generated', ... }, params, jobId: 0 };

async function onMatCapFile(file) {
  const id = ++state.jobId;                 // a newer upload makes older results stale
  setStatus('Converting…');
  try {
    const bitmap = await fileToImage(file);
    if (id !== state.jobId) return;         // user already dropped another file
    setStatus('Generating…');
    generator.setSource(bitmap);
    generator.render(state.params);
    renderer.setMatCap(generator.texture);
    setStatus('Ready');
  } catch (e) { if (id === state.jobId) setError(e.message); }
}
```

Same pattern for `onModelFile`. Dropping a file on the canvas counts as a MatCap upload. The model upload has its own button, so we never have to guess what a dropped file is. The render loop is `animate(canvas, (t, dt) => { camera.update(dt); renderer.render(camera.viewMatrix()); })`.

---

## 6. Reuse of the course helpers (verified against the real files)

| File | Use | Change |
|---|---|---|
| `MV.js` | Classic script. `vec*`, `mat4`, `mult`, `lookAt`, `translate`, `scalem`, `normalMatrix(m)` (mat4), `flatten(m)` (transposes for column-major upload) | none |
| `genmipmap.js` | Classic script. `generateMipmap(device, texture)` needs `mipLevelCount > 1` and usage `TEXTURE_BINDING \| RENDER_ATTACHMENT` | none |
| `OBJParser.js` | Classic script. `readOBJFile(url, scale, reverse)` → `{ vertices, normals, colors, indices }` (vec4 per vertex, `Uint32Array` indices, no UVs) | none (workarounds in `loadModel.js`) |
| `webgpu-utils.js` | Copy to `src/gpu.js` | **Keep:** math (`perspectiveWebGPU`, `clamp`, `directionFromAngles`, `rotationPart`), `initWebGPU`, `beginFrame`, buffers, `createUniformBuffer`, `vertexLayout` + `POS_NORMAL_LAYOUT`, `createPipeline`, `createDepthTexture`, `createImageTexture` (default MatCaps), `generateSphereWithNormals`, `createPhongControls`, `createControls`, `animate`. **Add:** `export` on `createControls` and `animate` (they are private today); `createTextureFromBitmap(device, bitmap, mipmaps)` (the texture half of `createImageTexture`); a resize helper. **Delete:** `WORKSHEETS`, `mountPart/Worksheet/Index`, header code, the 2D drawing section, ground/background quads, `shadowMatrix` |
| `style.css` | Take `:root` variables, `canvas`, `.controls`, `.error` | The rest (sticky header, tabs, `.part`) is for the worksheet site. Write a small own layout (full-viewport canvas + floating panel) |

Notes:

- `setupCanvas` fixes the canvas to a CSS pixel size, which we don't want for a full-viewport canvas. Use a `ResizeObserver` that sets `canvas.width/height = clientSize × devicePixelRatio` and recreates the depth texture.
- `initWebGPU` shares one device between all canvases. We only have one; fine.
- `createOBJBuffers` takes a **URL** and returns GPU buffers directly, so we can't inject smooth normals. That is why §5.4 has its own loader.

---

## 7. Integrating p2r3/convert

Facts that shape the design:

- Convert is an **app, not a library.** It has no `convert(file, 'png')` function. The unit is a *handler* (`init()`, `doConvert(inputFiles, inputFormat, outputFormat)`), and a graph search chains handlers. The logic that picks a path lives next to its UI code.
- It is **GPL-2.0.** Say so in our README. If our repo is public, our licence must be GPL-compatible.
- It is built with **Bun + Vite + TypeScript**, and expects WASM under `/convert/wasm/` (registered in its `vite.config.js`).
- Its own dependencies are **git submodules** (`src/handlers/…`). `git subtree` does not bring submodule contents with it.
- The first start builds a format list per handler (slow). It can be skipped by shipping a prebuilt cache file.

**Plan:** `convertAdapter.js` is a thin file that imports what it needs from `src/convert/` and exposes `convertFile(file, targetExt)`. We never edit the subtree. The **spike (§9, phase 0)** decides how the adapter gets its pieces:

- **A (preferred):** import the handlers, format detection and path finding from the subtree. Copy what convert's own tests do (`test/` has end-to-end conversion smoke tests that run without the UI).
- **B:** if A needs a one-line export in convert, patch the subtree minimally and note it in the README.
- **C (fallback):** run the whole convert app in a hidden `<iframe>` and talk to it with `postMessage`.

Two uses of the adapter: `png` for MatCap sources, `obj` for models. The docs list STL and OBJ among the 3D formats; the spike should check which inputs can really become OBJ.

Which files are accepted = whatever convert can turn into the target format. If it can't, show "Couldn't turn this file into an image" and let the user try another file. The preview `<img>` shows what convert actually produced.

---

## 8. Models

- `public/models/*.obj` only. Listed in `src/models.js` (name + relative URL, no leading `/`).
- The sphere is built in code (`generateSphereWithNormals(5)`). It's the best MatCap check: a sphere shows the MatCap itself.
- Credit the source and licence of every model/MatCap in `CREDITS.md`.
- Choose curved models (bunny, Suzanne, teapot, torus knot). A plane gives one flat colour with a MatCap; a cube shows three.
- Uploaded models: `.obj` directly; anything else through convert → OBJ. Size cap for uploads.

---

## 9. Plan (two people)

| Phase | Person A (rendering) | Person B (files) | Result |
|---|---|---|---|
| **0** | Vite + `index.html` + classic scripts + `gpu.js`; canvas clears, WebGPU works | **Convert spike** in a throwaway page: PDF/DOCX → PNG, STL → OBJ. Answer the questions below and pick A/B/C | Skeleton + decision about convert |
| **1** | `loadModel` (smooth normals), `matcap.wgsl`, `Renderer`, `Camera`; default MatCap PNGs + thumbnails; model select | `toImage.js` fast path (images only) | Shaded models, switchable MatCaps |
| **2** | Wire the UI panel | `generateMatCap` + `matcapGenerate.wgsl` + sliders | Upload a PNG → MatCap |
| **3** | Model upload (`toObj.js`, `.obj` direct) | `convertAdapter.js` → `toImage.js` slow path | Any supported file → MatCap; any supported model → OBJ |
| **4** | Status/errors, stale-job handling, mobile layout | Deploy test: build, upload `dist/` to a **sub-folder** of the DTU server, verify WASM paths, README (GPL note, credits) | Final site |

**Spike questions (write the answers into this file):**

1. Does `src/convert/src/handlers/` have all its files, or are there empty submodule folders? (`find src/convert/src/handlers -maxdepth 1 -type d -empty`)
2. How do convert's `test/` files run a conversion without the UI? Copy that into the adapter.
3. Where do WASM/asset URLs come from? If `/convert/wasm/` is hard-coded, it breaks under `~username/…`. It must work from a sub-path.
4. What exactly is `FileData` in `src/FormatHandler.ts` (field names)?
5. Can we load only a subset of handlers (image, document, font, 3D) to shrink `dist/`? What is the size of `dist/`?
6. Does a conversion freeze the page (then consider a worker) or does ffmpeg need `COOP/COEP` headers (the host can set them)?
7. Ship the prebuilt format-list cache to avoid the slow first start.
8. Which extensions work? Put the result in the panel as a hint.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Convert integration is more work than expected | Phase 0 spike first; image fast path means the app works without convert; fallback C |
| WASM/asset paths break on the DTU sub-path | `base: './'`; test a sub-folder deployment before the deadline |
| `dist/` is large (many handlers) | Lazy `import()` of the adapter; trim handlers if needed |
| Conversion output is a useless image (e.g. white PDF page) | The lighting layer (§5.2) still gives form; preview shows the input |
| Source image has transparency | `mix(white, rgb, a)` in the generator shader |
| Huge source image or file | ≤ 2048 px downscale; file size cap |
| Uploaded OBJ has `mtllib`, no normals, or wrong winding | Strip `mtllib`; always recompute smooth normals; two-sided normal test in `matcap.wgsl` |
| User drops a second file while the first converts | `jobId` check in `main.js` |
| No WebGPU | `initWebGPU` throws "WebGPU is not supported…"; show it in the page |
| GPL-2.0 from convert | State it in README; choose a compatible licence; credit MatCaps and models |

---

## 11. Defaults assumed

Not decided explicitly yet; change them here if you disagree.

- MatCap generation is **render passes**, not compute shaders.
- Mapping = whole image on the front hemisphere, **stretched** to the image's own aspect.
- Smooth normals are **always** recomputed for OBJ models.
- Two explicit upload buttons (MatCap source / model); drag-and-drop onto the canvas is a MatCap upload.
- No web worker unless the spike shows the page freezing.
- No export button, MSAA, auto-rotate, or background options.
