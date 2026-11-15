// Responsibility: a first-person camera. Turns input (how far the mouse moved, which way the
// user wants to move) into a position, a view direction and a view matrix. (The camera of
// worksheet 11, part 3.) It does not read the mouse or keyboard itself, see
// input/firstPersonInput.js.

import { vec3, add, scale, cross, normalize, lookAt } from '../math/mv.js';
import { clamp, directionFromAngles } from '../math/transforms.js';

// keep the polar angle a little away from 0 and pi, otherwise the view direction is parallel
// to the up vector and lookAt() breaks
const POLAR_MARGIN = 0.01;
const UP = vec3(0.0, 1.0, 0.0);

// speed: units per second. sensitivity: radians per pixel of mouse movement.
// Both can be changed at any time (camera.speed = 5).
export function createFlyCamera(input, {
  eye = [0.0, 0.0, 3.0],
  azimuth = 0.0,
  polar = Math.PI / 2,
  speed = 2.0,
  sensitivity = 0.003,
} = {}) {
  const camera = {
    speed,
    sensitivity,
    eye: vec3(...eye),
    azimuth,
    polar,

    // dt: seconds since the last frame
    update(dt) {
      // a long pause (hidden tab) should not make the camera jump
      dt = Math.min(dt, 0.1);

      const look = input.consumeLook();
      camera.azimuth += look.x * camera.sensitivity;
      camera.polar = clamp(camera.polar + look.y * camera.sensitivity, POLAR_MARGIN, Math.PI - POLAR_MARGIN);

      const direction = directionFromAngles(camera.azimuth, camera.polar);
      // Pointing to the right of the camera. cross(up, direction) would point to the left,
      // since the coordinate system is right handed.
      const right = normalize(cross(direction, UP));

      // dollying (forward and back), panning (sideways) and moving up and down in world space
      const { forward, sideways, rise } = input.moveAxes();
      const step = add(add(scale(forward, direction), scale(sideways, right)), scale(rise, UP));
      camera.eye = add(camera.eye, scale(camera.speed * dt, step));
    },

    viewMatrix() {
      const target = add(camera.eye, directionFromAngles(camera.azimuth, camera.polar));
      return lookAt(camera.eye, target, UP);
    },

    reset() {
      camera.eye = vec3(...eye);
      camera.azimuth = azimuth;
      camera.polar = polar;
    },
  };
  return camera;
}
