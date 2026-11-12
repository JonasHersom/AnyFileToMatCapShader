# AnyFileToMatCapShader - Architecture Document

## Overview

**Project**: Convert any file → image → MatCap → render 3D object with MatCap shading  
**Target**: Web-only (DTU student site), WebGPU  
**Language**: JavaScript (ES Modules) with JSDoc types  
**Architecture**: Feature-based modular, direct function calls between modules  
**Styling**: `src/style.css` (from course helpers)  
**Helpers**: Adapted from course worksheets (`webgpu-utils.js`, `MV.js`, `genmipmap.js`, `OBJParser.js`)

---

## Module Structure

```
src/
├── convert/                    # p2r3/convert (git subtree) - file → image conversion
│   └── ...                     # Existing universal converter, outputs FileData (Uint8Array + mime)
├── matcapManager/              # NEW: image → MatCap texture (WebGPU compute)
│   ├── index.js                # Main export: generateMatCap(device, imageData, options)
│   ├── types.js                # JSDoc typedefs for MatCapResult, MatCapOptions
│   ├── MatCapGenerator.js      # WebGPU compute pipeline orchestration
│   └── shaders/
│       └── matcapGeneration.wgsl  # Compute shader for MatCap creation
├── renderer/                   # NEW: 3D scene + WebGPU rendering pipeline
│   ├── index.js                # Main export: Renderer class
│   ├── types.js                # JSDoc typedefs for RendererConfig, ModelSource, ModelData
│   ├── Renderer.js             # Main renderer class
│   ├── ModelLoader.js          # Load .glb from public/ or uploaded .obj/.glb
│   ├── Camera.js               # Orbit camera controller (uses MV.js)
│   └── shaders/
│       └── matcap.wgsl         # Render shader (vertex + fragment)
├── shader/                     # NEW: Shared shader utilities
│   ├── index.js                # Shader module helpers
│   └── matcap.wgsl             # Re-export from renderer/shaders/
├── utils/                      # NEW: Course helpers (adapted)
│   ├── webgpu.js               # From webgpu-utils.js (initWebGPU, beginFrame, createPipeline, etc.)
│   ├── MV.js                   # Full copy - matrix/vector math
│   ├── genmipmap.js            # Full copy - mipmap generation
│   ├── OBJParser.js            # Full copy - OBJ loading
│   └── image.js                # ImageBitmap/FileData helpers
├── ui/                         # NEW: Main app UI (vanilla JS, uses webgpu-utils UI patterns)
│   ├── index.js                # Main export: App class
│   ├── App.js                  # Main app orchestration
│   ├── components/
│   │   ├── DropZone.js         # File drag-drop
│   │   ├── ModelSelector.js    # Built-in + custom model dropdown
│   │   ├── MatCapControls.js   # Method, resolution, contrast controls
│   │   └── ExportButton.js     # Download rendered image / MatCap texture
│   └── styles.css              # Extends base style.css
├── main.js                     # Entry point, wires modules together
├── style.css                   # Base styles (from tempHelpers/style.css)
└── index.html                  # Single HTML entry point
```

---

## Data Flow

```
User drops file
      │
      ▼
┌─────────────────┐
│   convert       │  (p2r3/convert) - converts ANY file → image (FileData)
│   (existing)    │
└────────┬────────┘
         │ FileData { data: Uint8Array, mime: string, name: string }
         ▼
┌─────────────────┐
│  matcapManager  │  (NEW) - WebGPU compute: image → spherical MatCap texture
│                 │  - Analyzes lighting, creates proper MatCap (not just lat-long)
└────────┬────────┘
         │ GPUTexture (MatCap) + bindGroup + metadata
         ▼
┌─────────────────┐
│    renderer     │  (NEW) - WebGPU render pipeline
│                 │  - Loads built-in models (public/models/*.glb)
│                 │  - Accepts user-uploaded .obj/.glb
│                 │  - Binds MatCap texture to shader
└────────┬────────┘
         │ Rendered frame to canvas
         ▼
    User sees 3D object shaded with their file as MatCap
```

---

## Module Interfaces (JSDoc Types)

### 1. convert (existing - p2r3/convert)

**Input**: `File` or `Uint8Array`  
**Output**: `FileData[]` (array because some conversions yield multiple files)

```js
/**
 * @typedef {Object} FileData
 * @property {Uint8Array} data
 * @property {string} mime
 * @property {string} name
 */

// Usage in our app:
/**
 * @param {File} file
 * @returns {Promise<FileData>}
 */
async function convertToImage(file) {
  // Use p2r3/convert's API to convert to PNG/JPG
  // Returns first image output
}
```

### 2. matcapManager (NEW)

```js
/**
 * @typedef {Object} MatCapResult
 * @property {GPUTexture} texture           // WebGPU texture (2D, spherical MatCap)
 * @property {GPUBindGroup} bindGroup       // Ready to bind in render pipeline
 * @property {MatCapMetadata} metadata
 */

/**
 * @typedef {Object} MatCapMetadata
 * @property {number} sourceWidth
 * @property {number} sourceHeight
 * @property {string} generationMethod      // 'spherical-fit' | 'lighting-analysis' | 'hybrid'
 * @property {number[]} [dominantLightDirection]  // [x, y, z] if lighting analysis used
 */

/**
 * @typedef {Object} MatCapOptions
 * @property {string} [method='hybrid']     // 'spherical-fit' | 'lighting-analysis' | 'hybrid'
 * @property {number} [resolution=512]      // Output texture size
 * @property {boolean} [enhanceContrast=false]
 */

/**
 * @param {GPUDevice} device
 * @param {FileData} imageData              // From convert module
 * @param {MatCapOptions} options
 * @returns {Promise<MatCapResult>}
 */
async function generateMatCap(device, imageData, options) { ... }
```

**Implementation Notes**:
- Runs on GPU via WebGPU compute shaders (`shader/matcapGeneration.wgsl`)
- **spherical-fit**: Maps 2D image to sphere (handles aspect ratio, avoids polar distortion)
- **lighting-analysis**: Analyzes image gradients to infer light direction, bakes specular highlights
- **hybrid**: Combines both (default)
- Output: 2D texture representing spherical MatCap (sampled with `vec2(normal.xy * 0.5 + 0.5)`)
- Uses `genmipmap.js` for mipmap generation

### 3. shader (NEW)

```wgsl
// src/renderer/shaders/matcap.wgsl

struct Uniforms {
  modelViewProjection: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  cameraPosition: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var matcapTexture: texture_2d<f32>;
@group(0) @binding(2) var matcapSampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) viewDir: vec3<f32>,
  @location(2) uv: vec2<f32>,
}

@vertex
fn main_vs(input: VertexInput) -> VertexOutput { ... }

@fragment
fn main_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  // Spherical MatCap lookup: uv = normal.xy * 0.5 + 0.5
  // OR reflection lookup: R = reflect(-viewDir, normal); uv = R.xy * 0.5 + 0.5
  let uv = input.normal.xy * 0.5 + 0.5;
  return textureSample(matcapTexture, matcapSampler, uv);
}
```

### 4. renderer (NEW)

```js
/**
 * @typedef {Object} ModelSource
 * @property {'builtin' | 'uploaded'} type
 * @property {string} name                    // Built-in: 'sphere', 'torus-knot', 'bunny', etc.
 * @property {string} [url]                   // For uploaded: object URL
 * @property {ArrayBuffer} [data]             // For uploaded: raw buffer
 */

/**
 * @typedef {Object} RendererConfig
 * @property {HTMLCanvasElement} canvas
 * @property {GPUDevice} device
 * @property {GPUTextureFormat} format
 * @property {Map<string, ModelData>} builtInModels  // Preloaded from public/models/
 */

/**
 * @typedef {Object} ModelData
 * @property {GPUBuffer} vertexBuffer
 * @property {GPUBuffer} indexBuffer
 * @property {number} indexCount
 * @property {string} indexFormat
 * @property {number[]} boundsMin
 * @property {number[]} boundsMax
 * @property {number[]} center
 */

class Renderer {
  /**
   * @param {RendererConfig} config
   */
  constructor(config) { ... }

  /**
   * @param {ModelSource} source
   * @returns {Promise<ModelHandle>}
   */
  async loadModel(source) { ... }

  /**
   * @param {MatCapResult} matCapResult
   */
  setMatCap(matCapResult) { ... }

  /**
   * @param {Camera} camera
   */
  setCamera(camera) { ... }

  render() { ... }

  /**
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) { ... }

  dispose() { ... }
}
```

**Built-in Models** (stored in `public/models/`):
- `sphere.glb` - Perfect sphere (best for MatCap preview)
- `torus-knot.glb` - Complex curvature
- `bunny.glb` - Stanford bunny (organic shape)
- `cube.glb` - Sharp edges
- `plane.glb` - Flat surface

**Model Loading**:
- Built-in: Load `.glb` via `fetch` + parse with three.js GLTFLoader (or custom minimal parser)
- Uploaded `.obj`: Use `OBJParser.js` → `createOBJBuffers` from webgpu-utils
- Uploaded `.glb`: Use three.js GLTFLoader (import only the loader, not full three.js)

### 5. ui (NEW)

```js
class App {
  constructor() {
    /** @type {Renderer} */ this.renderer = null;
    /** @type {MatCapManager} */ this.matcapManager = null;
    /** @type {ConvertModule} */ this.convertModule = null;

    /** @type {File|null} */ this.currentFile = null;
    /** @type {ModelSource} */ this.currentModel = { type: 'builtin', name: 'sphere' };
    /** @type {MatCapOptions} */ this.matCapOptions = { method: 'hybrid', resolution: 512 };
  }

  async init() { ... }
  async onFileDrop(file) { ... }
  async onModelSelect(source) { ... }
  async onMatCapOptionsChange(options) { ... }
  renderLoop() { ... }
}
```

**UI Components** (vanilla JS, using patterns from `webgpu-utils.js` `createControls`):
- Drop zone for file upload (full viewport overlay)
- 3D canvas (fills viewport)
- Model selector dropdown (built-in + "Upload custom...")
- MatCap options panel (method, resolution, contrast) - collapsible sidebar
- Export button (download rendered image / MatCap texture)

---

## WebGPU Pipeline Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      RENDER PASS                            │
├─────────────────────────────────────────────────────────────┤
│  Vertex Shader                                              │
│  - Transform position by MVP                                │
│  - Transform normal by normalMatrix                         │
│  - Compute viewDir = cameraPos - worldPos                   │
│  - Pass normal, viewDir, uv to fragment                     │
├─────────────────────────────────────────────────────────────┤
│  Fragment Shader (MatCap)                                   │
│  - Sample MatCap texture using:                             │
│      vec2 uv = normal.xy * 0.5 + 0.5;  // Spherical mapping │
│    OR                                                      │
│      vec3 R = reflect(-viewDir, normal);                    │
│      vec2 uv = vec2(R.x, R.y) * 0.5 + 0.5;  // Reflection  │
│  - Output color = texture(matcapTexture, uv)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   COMPUTE PASS (MatCap Gen)                 │
├─────────────────────────────────────────────────────────────┤
│  Input: 2D image texture (from convert)                     │
│  Output: 2D MatCap texture (spherical)                      │
│                                                             │
│  spherical-fit:                                             │
│  - For each output pixel (spherical coord θ, φ)             │
│  - Map to input image UV                                    │
│  - Handle polar regions specially                           │
│                                                             │
│  lighting-analysis:                                         │
│  - Compute image gradients (Sobel)                          │
│  - Find dominant light direction                            │
│  - Generate synthetic highlights                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Integration with p2r3/convert (git subtree)

The `src/convert` folder is a **git subtree** of `p2r3/convert`. 

**Usage in our app**:
```js
// src/convert/index.js - wrapper for our usage
import * as convert from './convert/src/main.ts'; // or appropriate entry

// Convert any file to PNG
/**
 * @param {File} file
 * @returns {Promise<FileData>}
 */
export async function convertToPng(file) {
  const result = await convert.convert({
    input: file,
    outputFormat: 'png',
    // Use convert's auto-format detection
  });
  return result.files[0]; // First output file
}
```

**Note**: We only need the core conversion logic, not the UI. The subtree gives us access to all handlers.

---

## Helper Files (from tempHelpers)

| File | Location | Purpose |
|------|----------|---------|
| `webgpu-utils.js` | `src/utils/webgpu.js` | Core WebGPU helpers (init, buffers, pipelines, textures, geometry, OBJ loading) |
| `MV.js` | `src/utils/MV.js` | Matrix/vector math (vec2/3/4, mat2/3/4, lookAt, perspective, ortho, inverse, normalMatrix) |
| `genmipmap.js` | `src/utils/genmipmap.js` | Mipmap generation for MatCap textures |
| `OBJParser.js` | `src/utils/OBJParser.js` | OBJ file parsing for user-uploaded models |
| `style.css` | `src/style.css` | Base styling for the app |

**Key functions from webgpu-utils.js to use**:
- `initWebGPU(canvas)` → device, context, format
- `beginFrame(device, context, options)` → render pass helper
- `createPipeline(device, options)` → render pipeline creation
- `createBindGroupLayout(device, entries)` → bind group layouts
- `createUniformBuffer(device, floatCount)` → uniform buffer with CPU copy
- `createVertexBuffer`, `createIndexBuffer`, `createEmptyVertexBuffer`
- `vertexLayout(formats)` → POS3_LAYOUT, POS_NORMAL_LAYOUT, POS_UV_LAYOUT
- `createImageTexture(device, url, mipmaps)` → load image as texture
- `generateSphere(level)`, `generateSphereWithNormals(level)` → procedural sphere
- `createOBJBuffers(device, url, scale, reverseNormals)` → load OBJ (needs OBJParser.js)
- `orbitEye(angle, radius, height)` → camera position
- `perspectiveWebGPU(fovy, aspect, near, far)` → projection matrix
- `createControls(container)` → UI controls (button, slider, select, checkbox, text)
- `animate(canvas, frame)` → animation loop with IntersectionObserver

---

## File Structure (New Files to Create)

```
src/
├── main.js                          # Entry point
├── style.css                        # Base styles (from tempHelpers)
├── index.html                       # Single HTML page
├── matcapManager/
│   ├── index.js                     # Main export: generateMatCap
│   ├── types.js                     # JSDoc typedefs
│   ├── MatCapGenerator.js           # WebGPU compute pipeline
│   └── shaders/
│       └── matcapGeneration.wgsl    # Compute shader
├── renderer/
│   ├── index.js                     # Main export: Renderer
│   ├── types.js                     # JSDoc typedefs
│   ├── Renderer.js                  # Main renderer class
│   ├── ModelLoader.js               # Load .glb from public/ or upload
│   ├── Camera.js                    # Orbit camera (uses MV.js)
│   └── shaders/
│       └── matcap.wgsl              # Render shader
├── shader/
│   ├── index.js                     # Shader utilities
│   └── matcap.wgsl                  # Re-export
├── utils/
│   ├── webgpu.js                    # From webgpu-utils.js
│   ├── MV.js                        # Full copy
│   ├── genmipmap.js                 # Full copy
│   ├── OBJParser.js                 # Full copy
│   └── image.js                     # ImageBitmap/FileData helpers
└── ui/
    ├── index.js                     # Main export: App
    ├── App.js                       # Main app class
    ├── components/
    │   ├── DropZone.js
    │   ├── ModelSelector.js
    │   ├── MatCapControls.js
    │   └── ExportButton.js
    └── styles.css                   # App-specific styles
```

---

## Implementation Priority

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| **1** | Copy helpers to `src/utils/`, set up Vite + `index.html`, WebGPU init | Canvas with WebGPU triangle |
| **2** | Create `Renderer` with built-in sphere (from `generateSphereWithNormals`), basic MatCap shader | 3D sphere with placeholder MatCap |
| **3** | Integrate p2r3/convert: file → image (FileData) | Upload file → see converted image |
| **4** | MatCap generation (GPU compute) - start with spherical-fit | File → MatCap texture on sphere |
| **5** | Lighting analysis MatCap generation | Advanced MatCap with highlights |
| **6** | UI: drop zone, model selector, controls, export | Complete single-page app |
| **7** | Polish: loading states, errors, responsive, performance | Production-ready |

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | JavaScript (ES Modules) + JSDoc | User preference, simpler than TS |
| Module communication | Direct function calls + JSDoc types | Simple, type-safe enough, no overhead |
| MatCap generation | WebGPU compute shaders | User requirement, parallel, fast |
| 3D format | glTF (.glb) built-in, .obj/.glb upload | Web standard, OBJParser for .obj |
| Camera | Orbit controls (mouse/touch) | Standard for MatCap preview, uses `orbitEye` |
| Styling | `style.css` from helpers + minimal additions | Consistency with course materials |
| Build | Vite (extend convert's config) | Fast dev, optimized prod, handles WASM |
| Mipmaps | `genmipmap.js` | Proper MatCap filtering at distance |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WebGPU not available | Show clear message, document limitation |
| Large file conversion slow | Show progress, use convert's web workers |
| MatCap compute shader complex | Start with spherical-fit (simpler), add lighting later |
| Memory pressure (textures) | Dispose unused textures, limit resolution to 512/1024 |
| convert subtree updates | Pin to specific commit, update intentionally |
| OBJ loading without normals | `createOBJBuffers` computes face normals, `reverseNormals` option |

---

## Next Steps

1. **Copy helpers** to `src/utils/` (webgpu.js, MV.js, genmipmap.js, OBJParser.js, style.css)
2. **Set up Vite config** extending convert's setup, add `index.html`
3. **Create WebGPU boilerplate** in `src/main.js` using `initWebGPU`
4. **Build renderer** with built-in sphere from `generateSphereWithNormals`
5. **Integrate convert** for file → image
6. **Implement MatCap generator** (compute shader)
7. **Build UI** and wire everything together