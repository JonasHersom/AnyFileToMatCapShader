// Shared helpers for all worksheets.
//
// MV.js has to be loaded as a plain <script> before the modules that use this file.
// genmipmap.js is needed for mipmapped textures and OBJParser.js for OBJ models.

export const CORNFLOWER = { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 };
export const DARK_BLUE = { r: 0.1, g: 0.1, b: 0.15, a: 1.0 };

// ---------------------------------------------------------------------------
// math
// ---------------------------------------------------------------------------

// MV.js produces OpenGL clip space (z in [-1, 1]), WebGPU wants z in [0, 1]
export function getWebGPUDepthMatrix() {
  return mat4(
    vec4(1.0, 0.0, 0.0, 0.0),
    vec4(0.0, 1.0, 0.0, 0.0),
    vec4(0.0, 0.0, 0.5, 0.5),
    vec4(0.0, 0.0, 0.0, 1.0)
  );
}

export function perspectiveWebGPU(fovy, aspect, near, far) {
  return mult(getWebGPUDepthMatrix(), perspective(fovy, aspect, near, far));
}

export function orthoWebGPU(left, right, bottom, top, near, far) {
  return mult(getWebGPUDepthMatrix(), ortho(left, right, bottom, top, near, far));
}

// a point on a circle around the y axis, for orbiting cameras
export function orbitEye(angle, radius, height = 0.0) {
  return vec3(radius * Math.sin(angle), height, radius * Math.cos(angle));
}

// Projection matrix for planar shadows from a point light onto the plane n.x + d = 0.
// With P = (n, d) and L = (light, 1) it is M = (P.L) I - L P^T. A point on the plane
// stays where it is, every other point ends up where the ray from the light through
// it hits the plane. The result has w != 1, the perspective divide sorts that out.
export function shadowMatrix(light, n, d) {
  const P = [n[0], n[1], n[2], d];
  const L = [light[0], light[1], light[2], 1.0];
  const PdotL = P[0] * L[0] + P[1] * L[1] + P[2] * L[2] + P[3] * L[3];
  const m = mat4();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      m[i][j] = (i === j ? PdotL : 0.0) - L[i] * P[j];
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// device and canvas
// ---------------------------------------------------------------------------

// every canvas on a page shares one device
let devicePromise = null;

function requestDevice() {
  if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
  return (async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    const device = await adapter.requestDevice();
    // without this, validation errors are silent and you just see an empty canvas
    device.addEventListener('uncapturederror', e => console.error('WebGPU error:', e.error.message));
    device.lost?.then(info => console.warn(`WebGPU device lost: ${info.message}`));
    return device;
  })();
}

export async function initWebGPU(canvas) {
  devicePromise ??= requestDevice();
  const device = await devicePromise;
  const context = canvas.getContext('webgpu');
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
  return { device, context, canvasFormat };
}

// css size is cssWidth x cssHeight; with hiDPI the drawing buffer gets one pixel per
// physical screen pixel so nothing is upscaled and blurry on retina screens
export function setupCanvas(canvas, cssWidth, cssHeight, hiDPI = false) {
  const scale = hiDPI ? window.devicePixelRatio || 1 : 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
}

// Starts a render pass on the canvas. Call submit() when you are done drawing.
// Pass an encoder if you already have one (e.g. after another pass in the same frame).
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
      Object.assign(descriptor.depthStencilAttachment, { stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'store' });
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
// buffers
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

// vertex buffer without data, for geometry that changes (write it with device.queue.writeBuffer)
export function createEmptyVertexBuffer(device, byteSize) {
  return device.createBuffer({ size: byteSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
}

// A uniform buffer together with its CPU copy:
//   const u = createUniformBuffer(device, 36);
//   u.set(0, flatten(mvp));   // fill floats starting at float index 0
//   u.upload();
// Give every object in a render pass its own buffer. writeBuffer() takes effect before
// the submitted commands run, so objects sharing a buffer would all see the last values.
export function createUniformBuffer(device, floatCount) {
  const data = new Float32Array(floatCount);
  const buffer = device.createBuffer({
    size: Math.ceil(floatCount * 4 / 16) * 16,
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
// vertex layouts, shaders, pipelines
// ---------------------------------------------------------------------------

const FORMAT_BYTES = { float32x2: 8, float32x3: 12, float32x4: 16 };

// Layout of one interleaved vertex buffer, e.g. vertexLayout(['float32x4', 'float32x2'])
// is position (location 0) followed by uv (location 1). Use firstLocation for a second
// buffer that continues the numbering.
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

export async function loadShader(device, url) {
  const code = await (await fetch(url)).text();
  return device.createShaderModule({ code });
}

// Creates a render pipeline. shader is WGSL source or a module from loadShader().
// depth: true gives depth24plus with "less" and depth writes; pass an object to change
// any of those (or to add a stencil state).
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

// Bind group layout from a short description, so that several pipelines can share bind
// groups ('auto' layouts only work with the pipeline they were made for).
// entries: [binding, kind] pairs, kind being 'uniform', 'sampler', 'texture' (filterable),
// 'unfilterable-texture' (e.g. rgba32float), 'cube-texture'.
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
// textures
// ---------------------------------------------------------------------------

export function createDepthTexture(device, width, height, format = 'depth24plus') {
  return device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
}

const mipLevelCount = (width, height) => 1 + Math.floor(Math.log2(Math.max(width, height)));

// colorSpaceConversion 'none' keeps the texel values exactly as in the file, which matters
// for data like normal maps
function loadBitmap(url) {
  return fetch(url)
    .then(response => response.blob())
    .then(blob => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
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
  if (mipmaps) generateMipmap(device, texture);
  return texture;
}

// 1x1 texture with a single colour, e.g. [255, 0, 0, 255]
export function createSolidColorTexture(device, rgba) {
  const texture = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}

export function createCheckerTexture(device, { size = 64, squareSize = 8, mipmaps = false } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const white = (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0;
      const i = (y * size + x) * 4;
      data.fill(white ? 255 : 0, i, i + 3);
      data[i + 3] = 255;
    }
  }
  const texture = device.createTexture({
    size: [size, size],
    format: 'rgba8unorm',
    mipLevelCount: mipmaps ? mipLevelCount(size, size) : 1,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (mipmaps ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
  });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size]);
  if (mipmaps) generateMipmap(device, texture);
  return texture;
}

// Cube map from six image urls in the order +x, -x, +y, -y, +z, -z. View it with
// texture.createView({ dimension: 'cube' }). flipY flips every face vertically on upload.
export async function createCubeMap(device, urls, flipY = false) {
  const faces = await Promise.all(urls.map(loadBitmap));
  const { width, height } = faces[0];
  const texture = device.createTexture({
    size: [width, height, 6],
    format: 'rgba8unorm',
    mipLevelCount: mipLevelCount(width, height),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  faces.forEach((source, layer) => {
    device.queue.copyExternalImageToTexture({ source, flipY }, { texture, origin: [0, 0, layer] }, [width, height]);
  });
  generateMipmap(device, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// 3D geometry
// ---------------------------------------------------------------------------

function normalized(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return vec3(v[0] / length, v[1] / length, v[2] / length);
}

function midpoint(u, v) {
  return normalized(vec3(u[0] + v[0], u[1] + v[1], u[2] + v[2]));
}

// Unit sphere made by splitting every triangle of a tetrahedron into four, `level` times.
// Returns xyz triples, three vertices per triangle.
export function generateSphere(level) {
  const va = vec3(0.0, 0.0, 1.0);
  const vb = vec3(0.0, 0.942809, -0.333333);
  const vc = vec3(-0.816497, -0.471405, -0.333333);
  const vd = vec3(0.816497, -0.471405, -0.333333);

  let triangles = [
    [va, vb, vc],
    [va, vc, vd],
    [va, vd, vb],
    [vd, vc, vb],
  ].map(triangle => triangle.map(normalized));

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

// A sphere (xyz triples, layout POS3_LAYOUT) with "+" and "-" buttons that change the
// subdivision level between 0 and 6. Read sphere.vertexCount when drawing.
export function createSubdividedSphere(device, ui, level = 3) {
  const maxLevel = 6;
  // big enough for the largest sphere, so the buffer never has to be recreated
  const vertexBuffer = createEmptyVertexBuffer(device, 1024 * 1024);
  const sphere = { vertexBuffer, vertexCount: 0 };

  const setLevel = (newLevel) => {
    level = Math.max(0, Math.min(maxLevel, newLevel));
    const vertices = generateSphere(level);
    device.queue.writeBuffer(vertexBuffer, 0, vertices);
    sphere.vertexCount = vertices.length / 3;
    label.set(`Current level: ${level}`);
  };
  ui.button('Increment subdivision (+)', () => setLevel(level + 1));
  ui.button('Decrement subdivision (-)', () => setLevel(level - 1));
  const label = ui.text();
  setLevel(level);
  return sphere;
}

// The same sphere as interleaved [x y z 1 | nx ny nz 0] (POS_NORMAL_LAYOUT).
// On a unit sphere the normal is just the position.
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

// The 12 edges of the unit cube [0, 1]^3 as a line list (24 vertices, xyz each)
export const WIRE_CUBE = new Float32Array([
  // bottom face (z = 0)
  0, 0, 0,  1, 0, 0,
  1, 0, 0,  1, 1, 0,
  1, 1, 0,  0, 1, 0,
  0, 1, 0,  0, 0, 0,
  // top face (z = 1)
  0, 0, 1,  1, 0, 1,
  1, 0, 1,  1, 1, 1,
  1, 1, 1,  0, 1, 1,
  0, 1, 1,  0, 0, 1,
  // the four edges in between
  0, 0, 0,  0, 0, 1,
  1, 0, 0,  1, 0, 1,
  1, 1, 0,  1, 1, 1,
  0, 1, 0,  0, 1, 1,
]);

// Horizontal quad in the plane y = `y` with x in [xMin, xMax] and z from zNear to zFar
// (zFar < zNear, the camera looks down -z). The texture covers the quad exactly once and
// is upright for someone standing at the near edge. Layout: POS_UV_LAYOUT.
export function createGroundQuad(device, y, xMin, xMax, zNear, zFar) {
  const vertices = new Float32Array([
    xMin, y, zNear, 1.0,   0.0, 1.0,
    xMax, y, zNear, 1.0,   1.0, 1.0,
    xMax, y, zFar,  1.0,   1.0, 0.0,
    xMin, y, zFar,  1.0,   0.0, 0.0,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return {
    vertexBuffer: createVertexBuffer(device, vertices),
    indexBuffer: createIndexBuffer(device, indices),
    indexCount: indices.length,
    indexFormat: 'uint16',
  };
}

// A screen filling quad in clip coordinates, very close to the far plane (z = 0.999), for
// backgrounds. Layout POS_NORMAL_LAYOUT. Draw it with an identity mvp matrix.
export function createBackgroundQuad(device, z = 0.999) {
  const corner = (x, y) => [x, y, z, 1.0, 0.0, 0.0, 1.0, 0.0];
  const vertices = new Float32Array([
    ...corner(-1, -1), ...corner(1, -1), ...corner(1, 1),
    ...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1),
  ]);
  return { vertexBuffer: createVertexBuffer(device, vertices), vertexCount: 6 };
}

// the upper left 3x3 part of a 4x4 matrix (translation removed)
export function rotationPart(m) {
  const r = mat4();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = m[i][j];
  return r;
}

// Loads an OBJ file (needs OBJParser.js) into an interleaved position + normal vertex
// buffer (POS_NORMAL_LAYOUT) and an index buffer. The model is scaled while loading.
// reverseNormals only matters for files without normals, see OBJParser.js.
// Also returns the bounding box and its centre, handy for aiming a camera or light.
export async function createOBJBuffers(device, url, scale = 1.0, reverseNormals = false) {
  const obj = await readOBJFile(String(url), scale, reverseNormals);
  if (!obj) throw new Error(`Could not load ${url}`);

  const vertexCount = obj.vertices.length / 4;
  const data = new Float32Array(vertexCount * 8);
  const boundsMin = vec3(Infinity, Infinity, Infinity);
  const boundsMax = vec3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < vertexCount; i++) {
    data.set(obj.vertices.subarray(i * 4, i * 4 + 4), i * 8);
    data.set(obj.normals.subarray(i * 4, i * 4 + 4), i * 8 + 4);
    for (let k = 0; k < 3; k++) {
      boundsMin[k] = Math.min(boundsMin[k], obj.vertices[i * 4 + k]);
      boundsMax[k] = Math.max(boundsMax[k], obj.vertices[i * 4 + k]);
    }
  }
  const center = vec3(
    0.5 * (boundsMin[0] + boundsMax[0]),
    0.5 * (boundsMin[1] + boundsMax[1]),
    0.5 * (boundsMin[2] + boundsMax[2]));

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
// 2D drawing (worksheets 1 and 2)
// ---------------------------------------------------------------------------

// vertex = 2D position + RGBA colour
export const VERTEX_STRIDE_FLOATS = 6;
export const VERTEX_STRIDE_BYTES = VERTEX_STRIDE_FLOATS * 4;

export const SHADER_POS2_COLOR4 = `
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
};

@vertex
fn main_vs(@location(0) pos: vec2f, @location(1) color: vec4f) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(pos, 0.0, 1.0);
    output.color = color;
    return output;
}

@fragment
fn main_fs(@location(0) color: vec4f) -> @location(0) vec4f {
    return color;
}
`;

export const COLORS = {
  cornflower: vec4(0.3921, 0.5843, 0.9294, 1.0),
  black:      vec4(0.0, 0.0, 0.0, 1.0),
  white:      vec4(1.0, 1.0, 1.0, 1.0),
  red:        vec4(1.0, 0.0, 0.0, 1.0),
  green:      vec4(0.0, 1.0, 0.0, 1.0),
  blue:       vec4(0.0, 0.0, 1.0, 1.0),
  yellow:     vec4(1.0, 1.0, 0.0, 1.0),
};

// options for ui.select() in the drawing programs
export const BACKGROUND_CHOICES = [
  ['cornflower', 'Cornflower Blue'], ['red', 'Red'], ['green', 'Green'],
  ['blue', 'Blue'], ['white', 'White'], ['black', 'Black'],
];
export const SHAPE_CHOICES = [
  ['black', 'Black'], ['white', 'White'], ['red', 'Red'],
  ['green', 'Green'], ['blue', 'Blue'], ['yellow', 'Yellow'],
];

// mouse position -> normalized device coordinates in [-1, 1], y pointing up
export function getCanvasNDC(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return vec2(
    (x / canvas.clientWidth) * 2 - 1,
    1 - (y / canvas.clientHeight) * 2
  );
}

// a point is drawn as a small square, two triangles = six 2D positions
export function pointSquare(center, size) {
  return [
    vec2(center[0] - size, center[1] + size),
    vec2(center[0] - size, center[1] - size),
    vec2(center[0] + size, center[1] + size),

    vec2(center[0] + size, center[1] + size),
    vec2(center[0] - size, center[1] - size),
    vec2(center[0] + size, center[1] - size),
  ];
}

// The write functions below fill a Float32Array and return the next free float offset.
export function pushVertex(target, offset, pos, color) {
  target.set([pos[0], pos[1], color[0], color[1], color[2], color[3]], offset);
  return offset + VERTEX_STRIDE_FLOATS;
}

export function pushVertices(target, offset, positions, color) {
  for (const pos of positions) offset = pushVertex(target, offset, pos, color);
  return offset;
}

export function writePointSquare(target, offset, center, size, color) {
  return pushVertices(target, offset, pointSquare(center, size), color);
}

// p1, p2, p3 are { pos, color } so every corner can have its own colour
export function writeTriangle(target, offset, p1, p2, p3) {
  for (const p of [p1, p2, p3]) offset = pushVertex(target, offset, p.pos, p.color);
  return offset;
}

export function writeCircle(target, offset, center, radius, segments, color) {
  const step = (2 * Math.PI) / segments;
  for (let i = 0; i < segments; i++) {
    const p1 = vec2(center[0] + radius * Math.cos(i * step), center[1] + radius * Math.sin(i * step));
    const p2 = vec2(center[0] + radius * Math.cos((i + 1) * step), center[1] + radius * Math.sin((i + 1) * step));
    offset = pushVertices(target, offset, [center, p1, p2], color);
  }
  return offset;
}

// The drawing program of worksheet 2: a growing list of vertices (position + color) that is
// drawn as triangles on every frame. Vertices you append stay, "preview" vertices are only
// drawn for one frame (e.g. the corners of a triangle that is not finished yet).
export function createVertexBoard(device, context, canvasFormat, maxVertices) {
  const pipeline = createPipeline(device, {
    shader: SHADER_POS2_COLOR4,
    buffers: [POS2_COLOR_LAYOUT],
    format: canvasFormat,
  });
  const data = new Float32Array(maxVertices * VERTEX_STRIDE_FLOATS);
  const buffer = createEmptyVertexBuffer(device, data.byteLength);

  const board = {
    background: COLORS.cornflower,
    count: 0,

    // write(data, floatOffset) fills `vertexCount` vertices and returns the next float
    // offset, like writePointSquare() and friends. Returns false if there is no room left.
    append(vertexCount, write) {
      if (board.count + vertexCount > maxVertices) return false;
      write(data, board.count * VERTEX_STRIDE_FLOATS);
      board.count += vertexCount;
      return true;
    },

    clear(background = board.background) {
      board.count = 0;
      board.background = background;
    },

    draw(previewCount = 0, writePreview = null) {
      const total = board.count + previewCount;
      if (total > maxVertices) return;
      writePreview?.(data, board.count * VERTEX_STRIDE_FLOATS);
      if (total > 0) device.queue.writeBuffer(buffer, 0, data, 0, total * VERTEX_STRIDE_FLOATS);

      const { pass, submit } = beginFrame(device, context, { clear: board.background });
      if (total > 0) {
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, buffer);
        pass.draw(total);
      }
      submit();
    },
  };
  return board;
}

// The five sliders of the Phong model used in worksheets 4 and 5. Read .value of each:
// kd (also used as ka), ks, shininess, La (ambient light) and Le (emitted light).
export function createPhongControls(ui) {
  return {
    kd: ui.slider('Diffuse and ambient (k<sub>d</sub> = k<sub>a</sub>)', { min: 0, max: 1, step: 0.05, value: 0.8 }),
    ks: ui.slider('Specular (k<sub>s</sub>)', { min: 0, max: 1, step: 0.05, value: 0.5 }),
    shininess: ui.slider('Shininess (s)', { min: 1, max: 200, step: 1, value: 32 }),
    La: ui.slider('Ambient light (L<sub>a</sub>)', { min: 0, max: 1, step: 0.05, value: 0.2 }),
    Le: ui.slider('Light emission (L<sub>e</sub>)', { min: 0, max: 2, step: 0.1, value: 1.0 }),
  };
}

// ---------------------------------------------------------------------------
// pages: header, controls and mounting parts
//
// A part module exports main(app) where app has
//   app.canvas          the canvas of the part
//   app.ui              builds controls next to the canvas (buttons, sliders, ...)
//   app.animate(frame)  calls frame(time, dt) every animation frame (dt in seconds),
//                       but only while the canvas is on screen
// A part page calls mountPart(), a worksheet page mountWorksheet() and the front page
// mountIndex().
// ---------------------------------------------------------------------------

// Everything the pages need to know about the worksheets. Part n of worksheet w lives in
// Worksheet-w/Part-n/ and `file` is the name of its .html/.js (and .wgsl) files.
//   size     canvas size in css pixels
//   hiDPI    give the canvas one pixel per physical screen pixel
//   shader   there is a .wgsl file with the same name
//   answer   written answer (markdown)
//   assets   other files that belong to the part
export const WORKSHEETS = [
  { title: 'Getting started with WebGPU', parts: [
    { title: 'Clearing the canvas', file: 'w1p1', size: [512, 512],
      summary: 'Sets up WebGPU and clears the canvas to cornflower blue.' },
    { title: 'Drawing points', file: 'w1p2', size: [512, 512],
      summary: 'Three points, each drawn as a small square made of two triangles.' },
    { title: 'Colors per vertex', file: 'w1p3', size: [512, 512],
      summary: 'A triangle with a different color at every corner. The rasterizer interpolates between them.' },
    { title: 'Rotation with a uniform', file: 'w1p4', size: [512, 512],
      summary: 'A square that is rotated in the vertex shader by an angle from a uniform buffer.' },
    { title: 'Bouncing circle', file: 'w1p5', size: [512, 512],
      summary: 'A circle built from triangles, moved up and down with a uniform offset.' },
  ] },
  { title: 'Interaction and drawing', parts: [
    { title: 'Adding points', file: 'w2p1', size: [512, 512],
      summary: 'Click on the canvas to add points. The vertex buffer is rebuilt on every click.' },
    { title: 'Colors and clearing', file: 'w2p2', size: [512, 512],
      summary: 'Choose the color of new points and the background color. Clearing applies the background.' },
    { title: 'Drawing triangles', file: 'w2p3', size: [512, 512],
      summary: 'Switch between points and triangles. Three clicks make one triangle.' },
    { title: 'Drawing circles', file: 'w2p4', size: [512, 512],
      summary: 'Adds a circle mode: the first click is the center, the second one sets the radius.' },
  ] },
  { title: 'Transformations and projections', parts: [
    { title: 'Wireframe cube', file: 'w3p1', size: [512, 512],
      summary: 'A cube drawn with line segments through an orthographic projection.' },
    { title: 'One-, two- and three-point perspective', file: 'w3p2', size: [800, 450],
      summary: 'Three instances of the cube with different rotations show the types of perspective.' },
    { title: 'Theory', answer: 'w3p3.md',
      summary: 'Written answer about affine and viewing transformations.' },
  ] },
  { title: 'Lighting and shading', parts: [
    { title: 'Loop subdivision sphere', file: 'w04p1', size: [600, 600], hiDPI: true, shader: true,
      summary: 'A sphere made by subdividing a tetrahedron. The colors show the vertex positions.' },
    { title: 'Depth buffering and backface culling', file: 'w04p2', size: [600, 600], hiDPI: true, shader: true,
      summary: 'The same sphere with a depth buffer and culling of back faces.' },
    { title: 'Gouraud shading and orbiting camera', file: 'w04p3', size: [600, 600], hiDPI: true, shader: true,
      summary: 'Diffuse lighting computed per vertex from a directional light, with an orbiting camera.' },
    { title: 'Phong reflection model (per vertex)', file: 'w04p4', size: [600, 600], hiDPI: true, shader: true,
      summary: 'Ambient, diffuse and specular terms per vertex. The sliders change the material and the light.' },
    { title: 'Phong shading (per fragment)', file: 'w04p5', size: [600, 600], hiDPI: true, shader: true,
      summary: 'The same model evaluated per fragment with interpolated normals.' },
    { title: 'Theory questions', answer: 'w04p6.md',
      summary: 'Written answers about shading models, light types and the eye position.' },
  ] },
  { title: 'Loading models', parts: [
    { title: 'Server deployment verification', file: 'w05p1', size: [600, 600], hiDPI: true, shader: true,
      summary: 'A single triangle to check that everything is served correctly.' },
    { title: 'The model', assets: ['platypus.obj'],
      summary: 'The OBJ model used in the following parts.' },
    { title: 'OBJ mesh loader (unlit)', file: 'w05p3', size: [600, 600], hiDPI: true, shader: true,
      summary: 'The model loaded from an OBJ file, drawn with an orbiting camera.' },
    { title: 'Phong shaded mesh', file: 'w05p4', size: [600, 600], hiDPI: true, shader: true, answer: 'w05p4.md',
      summary: 'The model with Phong shading and the normals from the OBJ file.' },
  ] },
  { title: 'Texture mapping', parts: [
    { title: 'Textured rectangle setup', file: 'w06p1', size: [800, 600], hiDPI: true, shader: true,
      summary: 'A large ground rectangle with a repeating checkerboard texture.' },
    { title: 'Texture filtering and mipmapping controls', file: 'w06p2', size: [600, 600], hiDPI: true, shader: true,
      summary: 'Change the wrap modes, the filtering and the mipmapping of the checkerboard.' },
    { title: 'Earth textured globe', file: 'w06p3', size: [600, 600], hiDPI: true, shader: true, answer: 'w06p3.md', assets: ['earth.jpg'],
      summary: 'A sphere textured with spherical coordinates computed from the normal.' },
  ] },
  { title: 'Environment mapping and normal mapping', parts: [
    { title: 'Cube map initialization', file: 'w07p1', size: [600, 600], hiDPI: true, shader: true,
      summary: 'A sphere textured with a cube map, looked up with the world space normal.' },
    { title: 'Environment background quad', file: 'w07p2', size: [600, 600], hiDPI: true, shader: true, answer: 'w07p2.md',
      summary: 'A screen filling quad near the far plane shows the cube map as background.' },
    { title: 'Reflection mapping', file: 'w07p3', size: [600, 600], hiDPI: true, shader: true,
      summary: 'The sphere becomes a mirror: the cube map is looked up in the direction of reflection.' },
    { title: 'Bump mapping (normal mapping)', file: 'w07p4', size: [600, 600], hiDPI: true, shader: true,
      summary: 'A normal map perturbs the normal of the mirror ball. Tick the box to see the normal map itself.' },
  ] },
  { title: 'Projection shadows and render pipeline', parts: [
    { title: 'Scene', file: 'w08p1', size: [800, 600], hiDPI: true, shader: true,
      summary: 'A marble ground and two red quads, each with its own texture and bind group.' },
    { title: 'Projection shadows', file: 'w08p2', size: [800, 600], hiDPI: true, shader: true,
      summary: 'The quads are projected onto the ground from a point light that circles the scene.' },
    { title: 'Shadow polygon culling using the z-buffer', file: 'w08p3', size: [800, 600], hiDPI: true, shader: true,
      summary: 'A "greater" depth test keeps the shadows from being drawn outside the ground.' },
    { title: 'Transparency for ambient light', file: 'w08p4', size: [800, 600], hiDPI: true, shader: true,
      summary: 'Alpha blending makes the shadows semi-transparent, so the ground shows through.' },
    { title: 'Projection shadows from an object', file: 'w08p5', size: [800, 600], hiDPI: true, shader: true,
      summary: 'A teapot with its shadow. The stencil buffer makes sure every shadow pixel is drawn only once.' },
  ] },
  { title: 'Shadow mapping', parts: [
    { title: 'Scene', file: 'w09p1', size: [800, 600], hiDPI: true, shader: true,
      summary: 'A teapot jumping over a marble ground, lit by a point light that circles the scene.' },
    { title: 'Shadow map', file: 'w09p2', size: [800, 600], hiDPI: true, shader: true,
      summary: 'The scene is rendered from the light into a texture. The ground shows that depth texture.' },
    { title: 'Shadow mapping', file: 'w09p3', size: [800, 600], hiDPI: true, shader: true,
      summary: 'The depth texture decides which fragments are in shadow. Ambient light keeps shadows from being black.' },
    { title: 'Percentage-closer filtering', file: 'w09p4', size: [800, 600], hiDPI: true, shader: true,
      summary: 'Averages several shadow map lookups for smoother shadow edges. The slider sets the filter size.' },
  ] },
];

// the folder of the site (the one that contains Helpers/ and Worksheet-1/ ...)
const siteRoot = new URL('../', import.meta.url);

const worksheetUrl = (worksheet) => new URL(`Worksheet-${worksheet}/index.html`, siteRoot);
const partFolder = (worksheet, part) => new URL(`Worksheet-${worksheet}/Part-${part}/`, siteRoot);

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

function link(href, text, current = false, title = null) {
  const a = el('a', { href: String(href) }, text);
  if (current) a.setAttribute('aria-current', 'page');
  if (title) a.title = title;
  return a;
}

// ---- header ----

// worksheet / part: what is shown now. onWorksheetPage: part tabs jump within the page
// instead of opening the part's own page.
function createHeader({ worksheet = null, part = null, onWorksheetPage = false } = {}) {
  const worksheetTabs = el('nav', { class: 'tabs worksheet-tabs' });
  WORKSHEETS.forEach((info, i) => {
    const number = i + 1;
    worksheetTabs.append(link(worksheetUrl(number), number, number === worksheet, `Worksheet ${number}: ${info.title}`));
  });

  const brand = link(new URL('index.html', siteRoot), '02561 Computer Graphics');
  brand.className = 'brand';
  const header = el('header', { class: 'site-header' },
    el('div', { class: 'bar' }, brand, el('span', { class: 'label' }, 'Worksheet'), worksheetTabs));

  if (worksheet) {
    const info = WORKSHEETS[worksheet - 1];
    const partTabs = el('nav', { class: 'tabs part-tabs' },
      el('span', { class: 'label' }, `${worksheet}. ${info.title}`),
      link(worksheetUrl(worksheet), 'All parts', onWorksheetPage));
    info.parts.forEach((partInfo, i) => {
      const number = i + 1;
      const target = onWorksheetPage || !partInfo.file
        ? `${worksheetUrl(worksheet)}#part-${number}`
        : new URL(`${partInfo.file}.html`, partFolder(worksheet, number));
      partTabs.append(link(target, `Part ${number}`, number === part, partInfo.title));
    });
    header.append(partTabs);
  }
  return header;
}

// ---- controls ----

// Builds controls inside `container`. Everything returns an object you read in your frame
// function (slider.value, checkbox.checked, ...), so there is no need to look elements up.
function createControls(container) {
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

    // a button that flips between on and off; read state.on
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

    // options: plain strings or [value, label] pairs
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

    // a line of text you can change: const mode = ui.text('Mode: points'); mode.set('...')
    text(initial = '') {
      const span = el('span', { class: 'status' }, initial);
      container.append(span);
      return { set(value) { span.textContent = value; } };
    },
  };
}

// ---- animation ----

// frame(time, dt) runs every animation frame while the canvas is on screen, so parts
// further down a long page do not keep the GPU busy
function animate(canvas, frame) {
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
        last = performance.now();   // no big time step after the pause
        schedule();
      }
    }).observe(canvas);
  }
  schedule();
}

// ---- one part ----

function createPartSection(worksheet, number, info, { standalone }) {
  const folder = partFolder(worksheet, number);
  const canvas = info.size ? el('canvas') : null;
  const controls = el('div', { class: 'controls' });

  const links = el('p', { class: 'links' });
  const addLink = (name, text) => links.append(link(new URL(name, folder), text));
  if (info.file && !standalone) addLink(`${info.file}.html`, 'open on its own page');
  if (info.file) addLink(`${info.file}.js`, 'source');
  if (info.shader) addLink(`${info.file}.wgsl`, 'shader');
  if (info.answer) addLink(info.answer, 'written answer');
  for (const asset of info.assets ?? []) addLink(asset, asset);

  const root = el('section', { class: 'part', id: `part-${number}` },
    el('h2', {}, `Part ${number}`, el('small', {}, info.title)),
    el('p', { class: 'summary' }, info.summary),
    canvas ? el('div', { class: 'part-body' }, canvas, controls) : '',
    links);
  return { root, canvas, controls };
}

async function runPart(section, info, main) {
  setupCanvas(section.canvas, info.size[0], info.size[1], info.hiDPI);
  const app = {
    canvas: section.canvas,
    ui: createControls(section.controls),
    animate: (frame) => animate(section.canvas, frame),
  };
  try {
    await main(app);
  } catch (error) {
    console.error(error);
    section.root.append(el('p', { class: 'error' }, error.message));
  }
}

function onVisible(node, callback) {
  if (typeof IntersectionObserver === 'undefined') return callback();
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    callback();
  }, { rootMargin: '300px' });
  observer.observe(node);
}

// ---- pages ----

// the page of a single part (Worksheet-w/Part-n/<file>.html)
export async function mountPart(worksheet, number, main) {
  const info = WORKSHEETS[worksheet - 1].parts[number - 1];
  document.title = `Worksheet ${worksheet}, part ${number}: ${info.title}`;
  const section = createPartSection(worksheet, number, info, { standalone: true });
  document.body.append(createHeader({ worksheet, part: number }), el('main', {}, section.root));
  await runPart(section, info, main);
}

// all parts of a worksheet on one page (Worksheet-w/index.html); a part is started when it
// is scrolled into view
export function mountWorksheet(worksheet) {
  const info = WORKSHEETS[worksheet - 1];
  document.title = `Worksheet ${worksheet}: ${info.title}`;
  const page = el('main', {}, el('h1', {}, `Worksheet ${worksheet}`, el('small', {}, info.title)));
  document.body.append(createHeader({ worksheet, onWorksheetPage: true }), page);

  info.parts.forEach((partInfo, i) => {
    const number = i + 1;
    const section = createPartSection(worksheet, number, partInfo, { standalone: false });
    page.append(section.root);
    if (!partInfo.file) return;
    const moduleUrl = new URL(`${partInfo.file}.js`, partFolder(worksheet, number));
    onVisible(section.root, async () => {
      const module = await import(moduleUrl.href);
      await runPart(section, partInfo, module.main);
    });
  });
}

// the front page with every worksheet and part
export function mountIndex() {
  document.title = '02561 Computer Graphics';
  const grid = el('div', { class: 'index-grid' });
  WORKSHEETS.forEach((info, i) => {
    const worksheet = i + 1;
    const parts = el('ol');
    info.parts.forEach((partInfo, j) => {
      const target = partInfo.file
        ? new URL(`${partInfo.file}.html`, partFolder(worksheet, j + 1))
        : `${worksheetUrl(worksheet)}#part-${j + 1}`;
      parts.append(el('li', {}, link(target, partInfo.title)));
    });
    grid.append(el('section', { class: 'card' },
      el('h2', {}, link(worksheetUrl(worksheet), `Worksheet ${worksheet}`), el('small', {}, info.title)),
      parts));
  });
  document.body.append(createHeader(), el('main', {}, el('h1', {}, '02561 Computer Graphics'), grid));
}
