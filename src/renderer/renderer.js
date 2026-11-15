// Responsibility: draw one mesh to the canvas. It owns the pipeline, the uniform buffer and
// the depth texture. It does not load models and does not read input: it is given a mesh
// (setMesh) and a camera (view matrix + eye position, render).

import shaderCode from './basic.wgsl?raw';
import { beginFrame, createDepthTexture } from '../gpu/device.js';
import { createUniformBuffer } from '../gpu/buffers.js';
import { createPipeline, POS_NORMAL_LAYOUT } from '../gpu/pipeline.js';
import { mat4, mult, flatten } from '../math/mv.js';
import { perspectiveWebGPU, fitToUnitBox } from '../math/transforms.js';

const FOV_DEGREES = 60.0;
const NEAR = 0.05;
const FAR = 200.0;
const BACKGROUND = [0.13, 0.14, 0.17, 1.0];

// uniform layout (floats): 0-15 viewProj | 16-31 model | 32-35 eye
const UNIFORM_FLOATS = 36;

export function createRenderer({ device, context, canvas, canvasFormat }) {
  const pipeline = createPipeline(device, {
    shader: shaderCode,
    buffers: [POS_NORMAL_LAYOUT],
    format: canvasFormat,
    depth: true,
  });
  const uniforms = createUniformBuffer(device, UNIFORM_FLOATS);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms.buffer } }],
  });

  let depthTexture = null;
  let mesh = null;
  let modelMatrix = mat4();

  // call after the canvas changed size (resizeCanvasToDisplaySize returned true)
  function resize() {
    depthTexture?.destroy();
    depthTexture = createDepthTexture(device, canvas.width, canvas.height);
  }
  resize();

  return {
    resize,

    // The renderer takes ownership of the mesh (from model/gpuMesh.js) and frees the previous one.
    setMesh(gpuMesh) {
      mesh?.destroy();
      mesh = gpuMesh;
      modelMatrix = fitToUnitBox(gpuMesh.bounds);
    },

    // view: 4x4 view matrix, eye: camera position (world space)
    render(view, eye) {
      const projection = perspectiveWebGPU(FOV_DEGREES, canvas.width / canvas.height, NEAR, FAR);
      uniforms.set(0, flatten(mult(projection, view)));
      uniforms.set(16, flatten(modelMatrix));
      uniforms.set(32, [eye[0], eye[1], eye[2], 1.0]);
      uniforms.upload();

      const { pass, submit } = beginFrame(device, context, { clear: BACKGROUND, depthTexture });
      if (mesh) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, mesh.vertexBuffer);
        pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
        pass.drawIndexed(mesh.indexCount);
      }
      submit();
    },
  };
}
