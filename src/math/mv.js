// MV.js (the matrix/vector library) is a <script> that defines plain global
// functions. This file is the ONE place where the app reads those globals. Every other file
// imports what it needs from here, so it is obvious which MV.js functions the app depends on.
//
// index.html must load MV.js with a normal <script> tag before the app module.

if (typeof globalThis.mat4 !== 'function') {
  throw new Error('MV.js is not loaded. Add <script src="./lib/MV.js"></script> before the app module in index.html.');
}

export const {
  vec3, vec4, mat4,
  add, scale, cross, normalize,
  mult, translate, scalem, lookAt, perspective,
  flatten,
} = globalThis;
