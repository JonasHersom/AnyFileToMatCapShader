// Responsibility: get a GPU device, size the canvas, start a frame.
// Nothing in here knows about models, cameras or shaders.

export async function initWebGPU(canvas) {
  if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No GPU adapter found.');
  const device = await adapter.requestDevice();
  // without this, validation errors are silent and you just see an empty canvas
  device.addEventListener('uncapturederror', e => console.error('WebGPU error:', e.error.message));
  device.lost?.then(info => console.warn(`WebGPU device lost: ${info.message}`));

  const context = canvas.getContext('webgpu');
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
  return { device, context, canvasFormat };
}

// Makes the drawing buffer match the size the canvas has on screen (one pixel per physical
// pixel, capped so that a 3x display does not render 9 times the pixels). Returns true if the
// size changed, which is when size-dependent resources (the depth texture) must be recreated.
export function resizeCanvasToDisplaySize(canvas, maxPixelRatio = 2) {
  const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

export function createDepthTexture(device, width, height, format = 'depth24plus') {
  return device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
}

// Starts a render pass on the canvas. Call submit() when you are done drawing.
//   clear: [r, g, b, a] or { r, g, b, a }
export function beginFrame(device, context, { clear = [0, 0, 0, 1], depthTexture = null } = {}) {
  const [r, g, b, a] = Array.isArray(clear) ? clear : [clear.r, clear.g, clear.b, clear.a];
  const encoder = device.createCommandEncoder();
  const descriptor = {
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r, g, b, a },
    }],
  };
  if (depthTexture) {
    descriptor.depthStencilAttachment = {
      view: depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    };
  }
  const pass = encoder.beginRenderPass(descriptor);
  return {
    pass,
    submit() {
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}
