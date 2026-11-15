// Responsibility: meshes made in code instead of loaded from a file.

import { vec3 } from '../math/mv.js';
import { computeBounds } from './geometry.js';

function normalized(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return vec3(v[0] / length, v[1] / length, v[2] / length);
}

function midpoint(u, v) {
  return normalized(vec3(u[0] + v[0], u[1] + v[1], u[2] + v[2]));
}

// Unit sphere made by splitting every triangle of a tetrahedron into four, `level` times
// (from the helpers of worksheet 4). Returns xyz triples, three vertices per triangle.
function generateSphere(level) {
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

export function createSphereMesh(level = 6) {
  const positions = generateSphere(level);
  const normals = positions.slice();   // on a unit sphere the normal is the position
  const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  return { positions, normals, indices, bounds: computeBounds(positions, indices) };
}
