// src/utils/webgpu.js
// Adapted from webgpu-utils.js (course helpers)
// Core WebGPU helpers for our project

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CORNFLOWER = { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 };
export const DARK_BLUE = { r: 0.1, g: 0.1, b: 0.15, a: 1.0 };

// ---------------------------------------------------------------------------
// Math helpers (minimal, using MV.js for heavy lifting)
// ---------------------------------------------------------------------------

/** @returns {Float32Array} 4x4 matrix for WebGPU depth range [0,1] */
export function getWebGPUDepthMatrix() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  ]);
}

/** @returns {Float32Array} perspective matrix for WebGPU */
export function perspectiveWebGPU(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const d = far - near;
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = -(near + far) / d;
  m[11] = -1;
  m[14] = -2 * near * far / d;
  m[15] = 0;
  // Apply WebGPU depth matrix
  m[10] = m[10] * 0.5 + m[11] * 0.5;
  m[14] = m[14] * 0.5 + m[15] * 0.5;
  return m;
}

/** @returns {Float32Array} orthographic matrix for WebGPU */
export function orthoWebGPU(left, right, bottom, top, near, far) {
  const w = right - left;
  const h = top - bottom;
  const d = far - near;
  const m = new Float32Array(16);
  m[0] = 2 / w;
  m[5] = 2 / h;
  m[10] = -2 / d;
  m[12] = -(left + right) / w;
  m[13] = -(top + bottom) / h;
  m[14] = -(near + far) / d;
  m[15] = 1;
  // Apply WebGPU depth matrix
  m[10] = m[10] * 0.5;
  m[14] = m[14] * 0.5 + 0.5;
  return m;
}

/** Camera position on a circle around Y axis */
export function orbitEye(angle, radius, height = 0.0) {
  return new Float32Array([
    radius * Math.sin(angle),
    height,
    radius * Math.cos(angle)
  ]);
}

// ---------------------------------------------------------------------------
// Device and Canvas
// ---------------------------------------------------------------------------

let devicePromise = null;

async function requestDevice() {
  if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No GPU adapter found.');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', e => console.error('WebGPU error:', e.error.message));
  device.lost?.then(info => console.warn(`WebGPU device lost: ${info.message}`));
  return device;
}

/**
 * Initialize WebGPU for a canvas
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat}>}
 */
export async function initWebGPU(canvas) {
  devicePromise ??= requestDevice();
  const device = await devicePromise;
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format };
}

/** Set canvas CSS size and pixel resolution */
export function setupCanvas(canvas, cssWidth, cssHeight, hiDPI = false) {
  const scale = hiDPI ? window.devicePixelRatio || 1 : 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
}

/**
 * Begin a render pass on the canvas
 * @param {GPUDevice} device
 * @param {GPUCanvasContext} context
 * @param {{clear?: {r,g,b,a}|number[], depthTexture?: GPUTexture, encoder?: GPUCommandEncoder}} options
 * @returns {{encoder: GPUCommandEncoder, pass: GPURenderPassEncoder, submit: () => void}}
 */
export function beginFrame(device, context, { clear = CORNFLOWER, depthTexture = null, encoder = device.createCommandEncoder() } = {}) {
  const [r, g, b, a] = Array.isArray(clear) ? clear : [clear.r, clear.g, clear.b, clear.a];
  const descriptor = {
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: Number(r), g: Number(g), b: Number(b), a: Number(a) },
    }],
  };
  if (depthTexture) {
    descriptor.depthStencilAttachment = {
      view: depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    };
    if (depthTexture.format.includes('stencil')) {
      Object.assign(descriptor.depthStencilAttachment, {
        stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'store'
      });
    }
  }
  const pass = encoder.beginRenderPass(descriptor);
  return {
    encoder,
    pass,
    submit() {
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

function createBufferWith(device, usage, data) {
  const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

export function createVertexBuffer(device, data) {
  return createBufferWith(device, GPUBufferUsage.VERTEX, data);
}

export function createIndexBuffer(device, data) {
  return createBufferWith(device, GPUBufferUsage.INDEX, data);
}

export function createEmptyVertexBuffer(device, byteSize) {
  return device.createBuffer({ size: byteSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
}

/**
 * Create a uniform buffer with CPU-side Float32Array for easy updates
 * @param {GPUDevice} device
 * @param {number} floatCount
 * @returns {{data: Float32Array, buffer: GPUBuffer, set: (offset:number, values:Float32Array|number[])=>void, upload: ()=>void}}
 */
export function createUniformBuffer(device, floatCount) {
  const data = new Float32Array(floatCount);
  const buffer = device.createBuffer({
    size: Math.ceil(floatCount * 4 / 16) * 16, // 16-byte aligned
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  return {
    data,
    buffer,
    set(floatOffset, values) { data.set(values, floatOffset); },
    upload() { device.queue.writeBuffer(buffer, 0, data); },
  };
}

// ---------------------------------------------------------------------------
// Vertex Layouts
// ---------------------------------------------------------------------------

const FORMAT_BYTES = { 'float32x2': 8, 'float32x3': 12, 'float32x4': 16 };

/**
 * Create vertex buffer layout descriptor
 * @param {string[]} formats e.g. ['float32x4', 'float32x2']
 * @param {number} firstLocation
 * @returns {GPUVertexBufferLayout}
 */
export function vertexLayout(formats, firstLocation = 0) {
  let offset = 0;
  const attributes = formats.map((format, i) => {
    const attribute = { shaderLocation: firstLocation + i, offset, format };
    offset += FORMAT_BYTES[format];
    return attribute;
  });
  return { arrayStride: offset, attributes };
}

export const POS2_LAYOUT = vertexLayout(['float32x2']);
export const POS3_LAYOUT = vertexLayout(['float32x3']);
export const POS2_COLOR_LAYOUT = vertexLayout(['float32x2', 'float32x4']);
export const POS_UV_LAYOUT = vertexLayout(['float32x4', 'float32x2']);
export const POS_NORMAL_LAYOUT = vertexLayout(['float32x4', 'float32x4']);

// ---------------------------------------------------------------------------
// Shaders and Pipelines
// ---------------------------------------------------------------------------

/** Load WGSL shader from URL */
export async function loadShader(device, url) {
  const code = await (await fetch(url)).text();
  return device.createShaderModule({ code });
}

/**
 * Create a render pipeline
 * @param {GPUDevice} device
 * @param {Object} options
 */
export function createPipeline(device, {
  shader,
  vs = 'main_vs',
  fs = 'main_fs',
  buffers = [],
  format,
  topology = 'triangle-list',
  cull = 'none',
  depth = false,
  blend,
  layout = 'auto',
  bindGroupLayouts,
}) {
  const module = typeof shader === 'string' ? device.createShaderModule({ code: shader }) : shader;
  const descriptor = {
    layout: bindGroupLayouts ? device.createPipelineLayout({ bindGroupLayouts }) : layout,
    vertex: { module, entryPoint: vs, buffers },
    fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
    primitive: { topology, cullMode: cull },
  };
  if (depth) {
    descriptor.depthStencil = {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
      ...(depth === true ? {} : depth),
    };
  }
  return device.createRenderPipeline(descriptor);
}

/**
 * Create a bind group layout from simple description
 * @param {GPUDevice} device
 * @param {Array<[number, string]>} entries - [[binding, kind], ...] kinds: 'uniform', 'sampler', 'texture', 'unfilterable-texture', 'cube-texture'
 * @returns {GPUBindGroupLayout}
 */
export function createBindGroupLayout(device, entries) {
  const stage = GPUShaderStage;
  const kinds = {
    'uniform': { visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
    'sampler': { visibility: stage.FRAGMENT, sampler: {} },
    'texture': { visibility: stage.FRAGMENT, texture: {} },
    'unfilterable-texture': { visibility: stage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    'cube-texture': { visibility: stage.FRAGMENT, texture: { viewDimension: 'cube' } },
  };
  return device.createBindGroupLayout({
    entries: entries.map(([binding, kind]) => ({ binding, ...kinds[kind] })),
  });
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

export function createDepthTexture(device, width, height, format = 'depth24plus') {
  return device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
}

const mipLevelCount = (width, height) => 1 + Math.floor(Math.log2(Math.max(width, height)));

async function loadBitmap(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export async function createImageTexture(device, url, mipmaps = true) {
  const bitmap = await loadBitmap(url);
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    mipLevelCount: mipmaps ? mipLevelCount(bitmap.width, bitmap.height) : 1,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
  if (mipmaps) {
    const { generateMipmap } = await import('./genmipmap.js');
    generateMipmap(device, texture);
  }
  return texture;
}

export function createSolidColorTexture(device, rgba) {
  const texture = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}

// ---------------------------------------------------------------------------
// 3D Geometry
// ---------------------------------------------------------------------------

function normalized(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return new Float32Array([v[0]/len, v[1]/len, v[2]/len]);
}

function midpoint(u, v) {
  return normalized(new Float32Array([u[0]+v[0], u[1]+v[1], u[2]+v[2]]));
}

/** Generate unit sphere positions (xyz triples) by subdividing tetrahedron */
export function generateSphere(level) {
  const va = new Float32Array([0, 0, 1]);
  const vb = new Float32Array([0, 0.942809, -0.333333]);
  const vc = new Float32Array([-0.816497, -0.471405, -0.333333]);
  const vd = new Float32Array([0.816497, -0.471405, -0.333333]);

  let triangles = [
    [va, vb, vc],
    [va, vc, vd],
    [va, vd, vb],
    [vd, vc, vb],
  ].map(t => t.map(normalized));

  for (let i = 0; i < level; i++) {
    triangles = triangles.flatMap(([v0, v1, v2]) => {
      const v01 = midpoint(v0, v1);
      const v12 = midpoint(v1, v2);
      const v20 = midpoint(v2, v0);
      return [[v0, v01, v20], [v1, v12, v01], [v2, v20, v12], [v01, v12, v20]];
    });
  }
  return new Float32Array(triangles.flat(2));
}

/** Sphere with interleaved position + normal (POS_NORMAL_LAYOUT) */
export function generateSphereWithNormals(level) {
  const positions = generateSphere(level);
  const count = positions.length / 3;
  const data = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = positions.subarray(i * 3, i * 3 + 3);
    data.set([x, y, z, 1.0, x, y, z, 0.0], i * 8);
  }
  return data;
}

/** Extract upper-left 3x3 of a 4x4 matrix (rotation part) */
export function rotationPart(m) {
  const r = new Float32Array(16);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i*4+j] = m[i*4+j];
  return r;
}

/**
 * Load OBJ file and create GPU buffers (needs OBJParser.js)
 * @param {GPUDevice} device
 * @param {string} url
 * @param {number} scale
 * @param {boolean} reverseNormals
 * @returns {Promise<Object>} {vertexBuffer, indexBuffer, indexCount, indexFormat, vertexCount, boundsMin, boundsMax, center}
 */
export async function createOBJBuffers(device, url, scale = 1.0, reverseNormals = false) {
  const { readOBJFile } = await import('./OBJParser.js');
  const obj = await readOBJFile(String(url), scale, reverseNormals);
  if (!obj) throw new Error(`Could not load ${url}`);

  const vertexCount = obj.vertices.length / 4;
  const data = new Float32Array(vertexCount * 8);
  const boundsMin = [Infinity, Infinity, Infinity];
  const boundsMax = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < vertexCount; i++) {
    data.set(obj.vertices.subarray(i * 4, i * 4 + 4), i * 8);
    data.set(obj.normals.subarray(i * 4, i * 4 + 4), i * 8 + 4);
    for (let k = 0; k < 3; k++) {
      boundsMin[k] = Math.min(boundsMin[k], obj.vertices[i * 4 + k]);
      boundsMax[k] = Math.max(boundsMax[k], obj.vertices[i * 4 + k]);
    }
  }
  const center = [
    0.5 * (boundsMin[0] + boundsMax[0]),
    0.5 * (boundsMin[1] + boundsMax[1]),
    0.5 * (boundsMin[2] + boundsMax[2])
  ];

  return {
    vertexBuffer: createVertexBuffer(device, data),
    indexBuffer: createIndexBuffer(device, obj.indices),
    indexCount: obj.indices.length,
    indexFormat: 'uint32',
    vertexCount,
    boundsMin,
    boundsMax,
    center,
  };
}

// ---------------------------------------------------------------------------
// UI Controls (from webgpu-utils.js createControls)
// ---------------------------------------------------------------------------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/**
 * Create UI controls in a container element
 * @param {HTMLElement} container
 * @returns {Object} control creators
 */
export function createControls(container) {
  const field = (labelHtml, input, extra) => {
    const label = el('label', {}, el('span', { html: labelHtml }), input);
    if (extra) label.append(extra);
    container.append(label);
  };

  return {
    button(text, onClick) {
      const button = el('button', {}, text);
      button.onclick = onClick;
      container.append(button);
      return button;
    },
    toggle(text, initial = true) {
      const state = { on: initial };
      const button = el('button');
      const update = () => { button.textContent = `${text}: ${state.on ? 'on' : 'off'}`; };
      button.onclick = () => { state.on = !state.on; update(); };
      update();
      container.append(button);
      return state;
    },
    checkbox(text, initial = false) {
      const input = el('input', { type: 'checkbox' });
      input.checked = initial;
      field(text, input);
      return { get checked() { return input.checked; } };
    },
    slider(text, { min = 0, max = 1, step = 0.05, value = 0 } = {}) {
      const input = el('input', { type: 'range', min, max, step });
      input.value = value;
      const output = el('output', {}, String(value));
      input.addEventListener('input', () => { output.textContent = input.value; });
      field(text, input, output);
      return { get value() { return Number(input.value); } };
    },
    select(text, options, selected) {
      const select = el('select');
      for (const option of options) {
        const [value, label] = Array.isArray(option) ? option : [option, option];
        select.append(el('option', { value }, label));
      }
      if (selected !== undefined) select.value = selected;
      field(text, select);
      return { get value() { return select.value; } };
    },
    text(initial = '') {
      const span = el('span', { class: 'status' }, initial);
      container.append(span);
      return { set(value) { span.textContent = value; } };
    },
  };
}

/**
 * Animation loop with IntersectionObserver (pauses when off-screen)
 * @param {HTMLCanvasElement} canvas
 * @param {(time:number, dt:number)=>void} frame
 */
export function animate(canvas, frame) {
  let visible = true;
  let scheduled = false;
  let last = performance.now();

  const tick = (time) => {
    scheduled = false;
    if (!visible) return;
    frame(time, (time - last) * 0.001);
    last = time;
    schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(tick);
  };

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        last = performance.now();
        schedule();
      }
    }).observe(canvas);
  }
  schedule();
}