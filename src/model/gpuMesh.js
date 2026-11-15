// Responsibility: upload MeshData (CPU) to GPU buffers.

import { createVertexBuffer, createIndexBuffer } from '../gpu/buffers.js';

// Returns what the renderer needs to draw the mesh. The vertex buffer is interleaved as
// [x y z 1 | nx ny nz 0], i.e. POS_NORMAL_LAYOUT in gpu/pipeline.js.
export function uploadMesh(device, mesh) {
  const vertexCount = mesh.positions.length / 3;
  const data = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    data[i * 8] = mesh.positions[i * 3];
    data[i * 8 + 1] = mesh.positions[i * 3 + 1];
    data[i * 8 + 2] = mesh.positions[i * 3 + 2];
    data[i * 8 + 3] = 1.0;
    data[i * 8 + 4] = mesh.normals[i * 3];
    data[i * 8 + 5] = mesh.normals[i * 3 + 1];
    data[i * 8 + 6] = mesh.normals[i * 3 + 2];
    data[i * 8 + 7] = 0.0;
  }

  const vertexBuffer = createVertexBuffer(device, data);
  const indexBuffer = createIndexBuffer(device, mesh.indices);
  return {
    vertexBuffer,
    indexBuffer,
    indexCount: mesh.indices.length,
    indexFormat: 'uint32',
    bounds: mesh.bounds,
    destroy() {
      vertexBuffer.destroy();
      indexBuffer.destroy();
    },
  };
}
