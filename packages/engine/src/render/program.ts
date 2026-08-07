const VERTEX_SHADER = 0x8b31;
const FRAGMENT_SHADER = 0x8b30;
const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
): WebGLProgram {
  const vertex = compileShader(gl, VERTEX_SHADER, "vertex", vertexSrc);
  const fragment = compileShader(gl, FRAGMENT_SHADER, "fragment", fragmentSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // The shaders are linked into the program by now and the program holds its own reference, so
  // deleting them here frees the sources rather than the compiled code.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, LINK_STATUS) === true) return program;
  const log = gl.getProgramInfoLog(program);
  gl.deleteProgram(program);
  throw new Error(`shader link failed: ${log ?? "no driver message"}`);
}

// Sampler uniforms are bound once when a program is built and never move, so every value that
// travels per frame is a float, a vector or a matrix. That is what makes dispatching on the shape
// of the value safe here -- an integer uniform would need the shape of the *uniform*, which only
// getActiveUniform knows.
export function setUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  values: Record<string, number | readonly number[]>,
): void {
  for (const [name, value] of Object.entries(values)) {
    const location = gl.getUniformLocation(program, name);
    if (location === null) continue;
    write(gl, location, name, value);
  }
}

function write(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation,
  name: string,
  value: number | readonly number[],
): void {
  if (typeof value === "number") return gl.uniform1f(location, value);
  const numbers = value as number[];
  switch (numbers.length) {
    case 2:
      return gl.uniform2fv(location, numbers);
    case 3:
      return gl.uniform3fv(location, numbers);
    case 4:
      return gl.uniform4fv(location, numbers);
    case 9:
      return gl.uniformMatrix3fv(location, false, numbers);
    case 16:
      return gl.uniformMatrix4fv(location, false, numbers);
    default:
      throw new Error(`uniform ${name}: no call for ${numbers.length} components`);
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  stage: string,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error(`${stage} shader could not be created`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, COMPILE_STATUS) === true) return shader;
  // The driver's message names the line and the symbol. Swallowing it and returning null is why
  // a broken shader usually shows up as a black canvas hours later instead of as a stack trace.
  const log = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw new Error(`${stage} shader failed to compile: ${log ?? "no driver message"}`);
}
