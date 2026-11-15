// Responsibility: create GPU buffers and fill them with data.

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

// A uniform buffer together with its CPU copy:
//   const u = createUniformBuffer(device, 36);
//   u.set(0, flatten(mvp));   // fill floats starting at float index 0
//   u.upload();
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
