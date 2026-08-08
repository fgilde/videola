// Somewhere for a pass to land that is not the screen. The effect chain needs two of them and
// takes turns, because a pass cannot read the texture it is writing.
//
// Colour only, no depth or stencil: nothing in this compositor is ever hidden by anything else.
export class RenderTarget {
  #gl: WebGL2RenderingContext;
  #framebuffer: WebGLFramebuffer;
  #texture: WebGLTexture;
  #width = 0;
  #height = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#framebuffer = gl.createFramebuffer();
    this.#texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#texture, 0);
  }

  get texture(): WebGLTexture {
    return this.#texture;
  }

  // Bound, sized and cleared in one call. Separating them is how a target ends up a frame behind
  // the drawing buffer after a resize: the pass still draws, into a viewport covering part of it,
  // and the rest of the picture is whatever the last frame left there.
  //
  bind(width: number, height: number): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    if (width !== this.#width || height !== this.#height) {
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.#width = width;
      this.#height = height;
      // Left bound, this texture would still be on a sampler unit while a pass draws into it,
      // which is a feedback loop the specification leaves undefined.
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    this.#gl.deleteFramebuffer(this.#framebuffer);
    this.#gl.deleteTexture(this.#texture);
  }
}
