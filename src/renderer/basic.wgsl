// Basic shader: Phong shading with a light at the camera, so whatever the user looks at is lit.
// Later this file is going to be replaced by the MatCap shader; the renderer does not care.

struct Uniforms {
    viewProj: mat4x4f,   // camera projection * view
    model: mat4x4f,      // places the mesh in front of the camera (translation + uniform scale)
    eyePos: vec4f,       // xyz: camera position (world space)
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

const ALBEDO: vec3f = vec3f(0.85, 0.87, 0.92);
const KD: f32 = 0.8;          // diffuse and ambient reflectance (k_d = k_a)
const KS: f32 = 0.4;          // specular reflectance
const SHININESS: f32 = 40.0;
const L_A: f32 = 0.2;         // ambient radiance
const L_E: f32 = 1.0;         // emitted radiance of the light

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) worldPos: vec3f,
    @location(1) normal: vec3f,
};

@vertex
fn main_vs(@location(0) pos: vec4f, @location(1) normal: vec4f) -> VertexOutput {
    let world = uniforms.model * pos;
    var output: VertexOutput;
    output.position = uniforms.viewProj * world;
    output.worldPos = world.xyz;
    // the model matrix only translates and scales uniformly, so it does not change the
    // direction of a normal (the length is fixed by normalize() below)
    output.normal = (uniforms.model * vec4f(normal.xyz, 0.0)).xyz;
    return output;
}

@fragment
fn main_fs(input: VertexOutput) -> @location(0) vec4f {
    let V = normalize(uniforms.eyePos.xyz - input.worldPos);   // towards the eye
    var N = normalize(input.normal);
    // Uploaded models can have the wrong winding, which flips their normals. A normal that
    // points away from the eye is turned around, so every model is lit from the outside.
    if (dot(N, V) < 0.0) { N = -N; }

    let L = V;                      // the light sits at the camera
    let R = reflect(-L, N);

    let ambient = KD * L_A;
    let diffuse = KD * L_E * max(dot(N, L), 0.0);
    let specular = select(0.0, KS * L_E * pow(max(dot(R, V), 0.0), SHININESS), dot(N, L) > 0.0);

    return vec4f(ALBEDO * (ambient + diffuse) + vec3f(specular), 1.0);
}
