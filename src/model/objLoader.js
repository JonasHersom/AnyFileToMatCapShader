// Responsibility: turn OBJ text (from a URL or a File) into MeshData (see geometry.js).
//
// The actual parsing is done by OBJParser.js (classic <script>, global OBJDoc). We use OBJDoc
// directly instead of readOBJFile() so that we can parse text we already have (an uploaded
// file) without making a URL for it. What we add on top of OBJParser.js:
//   - smooth normals: OBJParser keeps one normal per vertex, taken from the last face that
//     uses it, which looks faceted. We always recompute them (geometry.js).
//   - .mtl references are removed: OBJParser would fetch the .mtl file, which fails for
//     uploads, and the colours are not used here anyway.
//   - validation, so a broken file gives an error message instead of a blank screen.

import { computeBounds, computeSmoothNormals } from './geometry.js';

export const MAX_OBJ_BYTES = 100 * 1024 * 1024;

export async function loadObjFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status}).`);
  return parseObj(await response.text());
}

export async function loadObjFromFile(file) {
  if (file.size > MAX_OBJ_BYTES) {
    throw new Error(`The file is too large (${(file.size / 1048576).toFixed(0)} MB, the limit is ${MAX_OBJ_BYTES / 1048576} MB).`);
  }
  return parseObj(await file.text());
}

export async function parseObj(text) {
  const OBJDoc = globalThis.OBJDoc;
  if (typeof OBJDoc !== 'function') {
    throw new Error('OBJParser.js is not loaded. Add <script src="./lib/OBJParser.js"></script> to index.html.');
  }

  let info;
  try {
    const doc = new OBJDoc('model.obj');
    await doc.parse(removeMaterialReferences(text), 1.0, false);
    info = doc.getDrawingInfo();
  } catch (error) {
    console.error('OBJ parsing failed:', error);
    throw new Error('This does not look like a valid OBJ file.');
  }

  const vertexCount = info.vertices.length / 4;
  if (info.indices.length === 0) throw new Error('The OBJ file contains no faces.');

  // OBJParser stores vec4 per vertex, the rest of the app uses xyz
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = info.vertices[i * 4];
    positions[i * 3 + 1] = info.vertices[i * 4 + 1];
    positions[i * 3 + 2] = info.vertices[i * 4 + 2];
  }
  // a malformed number ("v 1.0 abc 3.0") ends up as NaN and would silently break the drawing
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error('The OBJ file contains invalid vertex coordinates.');
  }

  const indices = info.indices;
  return {
    positions,
    normals: computeSmoothNormals(positions, indices),
    indices,
    bounds: computeBounds(positions, indices),
  };
}

function removeMaterialReferences(text) {
  return text.replace(/^[ \t]*(mtllib|usemtl)\b.*$/gm, '');
}
