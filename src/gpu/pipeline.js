// Responsibility: describe vertex data and create render pipelines.

const FORMAT_BYTES = { float32x2: 8, float32x3: 12, float32x4: 16 };

// Layout of one interleaved vertex buffer, e.g. vertexLayout(['float32x4', 'float32x4'])
// is position (location 0) followed by normal (location 1).
export function vertexLayout(formats, firstLocation = 0) {
  let offset = 0;
  const attributes = formats.map((format, i) => {
    const attribute = { shaderLocation: firstLocation + i, offset, format };
    offset += FORMAT_BYTES[format];
    return attribute;
  });
  return { arrayStride: offset, attributes };
}

// [x y z 1 | nx ny nz 0] per vertex, the layout model/gpuMesh.js writes
export const POS_NORMAL_LAYOUT = vertexLayout(['float32x4', 'float32x4']);

// Creates a render pipeline. `shader` is WGSL source (a string).
// depth: true gives depth24plus with "less" and depth writes.
export function createPipeline(device, {
  shader,
  vs = 'main_vs',
  fs = 'main_fs',
  buffers = [],
  format,
  topology = 'triangle-list',
  cull = 'none',
  depth = false,
}) {
  const module = device.createShaderModule({ code: shader });
  const descriptor = {
    layout: 'auto',
    vertex: { module, entryPoint: vs, buffers },
    fragment: { module, entryPoint: fs, targets: [{ format }] },
    primitive: { topology, cullMode: cull },
  };
  if (depth) {
    descriptor.depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  }
  return device.createRenderPipeline(descriptor);
}
