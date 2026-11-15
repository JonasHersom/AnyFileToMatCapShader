// Responsibility: small maths helpers on top of MV.js (projection, view angles, model placement).
// No WebGPU, no DOM.

import { vec3, vec4, mat4, mult, translate, scalem, perspective } from './mv.js';

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// MV.js produces OpenGL clip space (z in [-1, 1]), WebGPU wants z in [0, 1]
function getWebGPUDepthMatrix() {
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

// Unit vector for a view direction given as two angles: the azimuth turns around the y axis
// (0 looks down -z, positive turns towards +x), the polar angle is measured from +y
// (0 straight up, pi/2 horizontal, pi straight down).
export function directionFromAngles(azimuth, polar) {
  return vec3(
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
    -Math.sin(polar) * Math.cos(azimuth));
}

// Model matrix that moves a mesh to the origin and scales it uniformly so that its longest
// side is 2 units long. Whatever the units of the OBJ file, it ends up in front of the camera.
// `bounds` comes from computeBounds() in model/geometry.js.
export function fitToUnitBox(bounds) {
  const s = bounds.maxExtent > 0 ? 2.0 / bounds.maxExtent : 1.0;
  const [cx, cy, cz] = bounds.center;
  return mult(scalem(s, s, s), translate(-cx, -cy, -cz));
}
