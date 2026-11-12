// src/main.js
// Entry point - WebGPU initialization + triangle test

import { initWebGPU, setupCanvas, beginFrame, createPipeline, createVertexBuffer, animate } from './utils/webgpu.js';

// ---------------------------------------------------------------------------
// Simple triangle shader
// ---------------------------------------------------------------------------

const TRIANGLE_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn main_vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(0.0, 0.5),    // top
    vec2f(-0.5, -0.5),  // bottom left
    vec2f(0.5, -0.5)    // bottom right
  );
  let colors = array<vec4f, 3>(
    vec4f(1.0, 0.0, 0.0, 1.0),  // red
    vec4f(0.0, 1.0, 0.0, 1.0),  // green
    vec4f(0.0, 0.0, 1.0, 1.0)   // blue
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.color = colors[vertexIndex];
  return output;
}

@fragment
fn main_fs(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`;

// ---------------------------------------------------------------------------
// FPS Counter
// ---------------------------------------------------------------------------

let frameCount = 0;
let lastFpsTime = performance.now();
const fpsCounter = document.getElementById('fps-counter');

function updateFps() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsCounter.textContent = `${frameCount} fps`;
    frameCount = 0;
    lastFpsTime = now;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const canvas = document.getElementById('canvas');
  const statusBar = document.getElementById('status-bar');
  
  // Set canvas to full viewport
  function resizeCanvas() {
    setupCanvas(canvas, window.innerWidth, window.innerHeight, true);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  
  // Initialize WebGPU
  let device, context, format;
  try {
    ({ device, context, format } = await initWebGPU(canvas));
    statusBar.textContent = `WebGPU ready (${device.adapter?.info?.type || 'unknown'} GPU)`;
    statusBar.classList.remove('hidden');
  } catch (err) {
    statusBar.textContent = `WebGPU init failed: ${err.message}`;
    statusBar.classList.remove('hidden');
    console.error(err);
    return;
  }
  
  // Create pipeline
  const pipeline = createPipeline(device, {
    shader: TRIANGLE_SHADER,
    format,
    topology: 'triangle-list',
  });
  
  // Create vertex buffer (empty - using vertex_index in shader)
  // We still need a buffer binding, so create a dummy one
  const vertexBuffer = device.createBuffer({
    size: 4, // minimal
    usage: GPUBufferUsage.VERTEX,
  });
  
  // Render loop
  animate(canvas, (time, dt) => {
    updateFps();
    
    const { pass, submit } = beginFrame(device, context);
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(3); // 3 vertices = 1 triangle
    submit();
  });
  
  // Hide status after 3 seconds
  setTimeout(() => statusBar.classList.add('hidden'), 3000);
}

main();