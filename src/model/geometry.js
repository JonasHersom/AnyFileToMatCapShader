// Responsibility: pure geometry on CPU mesh data. No WebGPU, no DOM, no MV.js.
//
// A mesh ("MeshData") everywhere in the app is:
//   positions: Float32Array  x y z per vertex
//   normals:   Float32Array  x y z per vertex (unit length)
//   indices:   Uint32Array   three per triangle
//   bounds:    see computeBounds()

// Bounding box of the vertices that triangles actually use (an OBJ file can contain unused
// vertices, which would otherwise stretch the box).
export function computeBounds(positions, indices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < indices.length; i++) {
    const p = indices[i] * 3;
    for (let k = 0; k < 3; k++) {
      const value = positions[p + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  if (indices.length === 0) { min.fill(0); max.fill(0); }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size,
    maxExtent: Math.max(size[0], size[1], size[2]),
  };
}

// Smooth vertex normals: every vertex gets the sum of the normals of the triangles around it,
// weighted by triangle area (the cross product's length is twice the area), then normalised.
// Assumes counter-clockwise front faces, like OBJ files.
export function computeSmoothNormals(positions, indices) {
  const normals = new Float32Array(positions.length);

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }

  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
    if (length > 1e-20) {
      normals[v] /= length;
      normals[v + 1] /= length;
      normals[v + 2] /= length;
    } else {
      normals[v + 1] = 1.0;   // unused or degenerate vertex: any unit vector will do
    }
  }
  return normals;
}
