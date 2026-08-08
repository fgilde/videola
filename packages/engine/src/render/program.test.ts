import { describe, expect, it } from "vitest";

import { compileProgram, setUniforms } from "./program";
import { recordingGl } from "./recording-gl";

const VERTEX = "#version 300 es\nvoid main() {}";
const FRAGMENT = "#version 300 es\nvoid main() {}";

describe("compileProgram", () => {
  it("reports the driver's message and the failing stage instead of returning null", () => {
    const recording = recordingGl({
      getShaderParameter: () => false,
      getShaderInfoLog: () => "ERROR: 0:7: 'vec5' : no such type",
    });
    expect(() => compileProgram(recording.gl, VERTEX, FRAGMENT)).toThrow(/vec5/);
    expect(() => compileProgram(recording.gl, VERTEX, FRAGMENT)).toThrow(/vertex/);
  });

  it("reports the linker's message when the stages do not fit together", () => {
    const recording = recordingGl({
      getProgramParameter: () => false,
      getProgramInfoLog: () => "ERROR: varying v_uv is not declared in the fragment shader",
    });
    expect(() => compileProgram(recording.gl, VERTEX, FRAGMENT)).toThrow(/v_uv/);
  });

  it("releases both shaders once they are linked into the program", () => {
    const recording = recordingGl();
    compileProgram(recording.gl, VERTEX, FRAGMENT);
    expect(recording.named("deleteShader")).toHaveLength(2);
  });

  it("releases the shaders and the program when linking fails", () => {
    const recording = recordingGl({ getProgramParameter: () => false });
    expect(() => compileProgram(recording.gl, VERTEX, FRAGMENT)).toThrow();
    expect(recording.named("deleteShader")).toHaveLength(2);
    expect(recording.named("deleteProgram")).toHaveLength(1);
  });
});

describe("setUniforms", () => {
  function written(values: Record<string, number | readonly number[]>): GlWrite[] {
    const recording = recordingGl();
    setUniforms(recording.gl, {} as WebGLProgram, values);
    return recording.calls
      .filter((call) => call.name.startsWith("uniform"))
      .map((call) => ({ name: call.name, args: call.args }));
  }

  it("picks the call that matches the shape of the value", () => {
    expect(written({ u_opacity: 0.5 })).toEqual([
      { name: "uniform1f", args: ["u_opacity", 0.5] },
    ]);
    expect(written({ u_uv: [0, 0.25, 1, 0.5] })).toEqual([
      { name: "uniform4fv", args: ["u_uv", [0, 0.25, 1, 0.5]] },
    ]);
    expect(written({ u_size: [16, 9] })).toEqual([{ name: "uniform2fv", args: ["u_size", [16, 9]] }]);
    expect(written({ u_tint: [1, 0, 0] })).toEqual([{ name: "uniform3fv", args: ["u_tint", [1, 0, 0]] }]);
  });

  it("writes a nine-element value as a matrix without transposing it", () => {
    const matrix = [2, 0, 0, 0, -2, 0, -1, 1, 1];
    expect(written({ u_matrix: matrix })).toEqual([
      { name: "uniformMatrix3fv", args: ["u_matrix", false, matrix] },
    ]);
  });

  // A uniform the compiler dropped because nothing reads it has no location, and writing to null
  // is a GL error on every frame for a value nobody wanted.
  it("skips a uniform that the shader compiler removed", () => {
    const recording = recordingGl({ getUniformLocation: () => null });
    setUniforms(recording.gl, {} as WebGLProgram, { u_unused: 1 });
    expect(recording.calls.filter((call) => call.name.startsWith("uniform"))).toEqual([]);
  });

  it("refuses a length that maps to no uniform call", () => {
    const recording = recordingGl();
    expect(() => setUniforms(recording.gl, {} as WebGLProgram, { u_odd: [1, 2, 3, 4, 5] })).toThrow(
      /u_odd/,
    );
  });
});

interface GlWrite {
  name: string;
  args: readonly unknown[];
}
