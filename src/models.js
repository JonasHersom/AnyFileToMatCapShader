// The built-in models. `builtin: 'sphere'` is made in code, the others are OBJ files in
// public/models/ (urls are relative to index.html, no leading slash, so the site also works
// from a sub-folder of the server).

export const MODELS = [
  { id: 'sphere', name: 'Sphere (built-in)', builtin: 'sphere' },
  { id: 'beaver', name: 'Beaver', url: 'public/models/beaver.obj' },
  { id: 'platypus', name: 'Platypus', url: 'public/models/platypus.obj' },
  { id: 'teapot', name: 'Teapot', url: 'public/models/teapot.obj' },
];
