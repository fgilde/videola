// The real default a caption is created with, so the pixel checks measure what the editor draws
// rather than a copy of it. Reached past the package barrel deliberately: the barrel also exports
// the wasm backend, and this harness is bundled as an IIFE where the glue module's `import.meta`
// resolves to nothing.
export { CAPTION_STYLE } from "@videola/core/src/captions";
// The real parser, so the pixel checks below start from the characters a `.cube` file carries
// rather than from a table somebody typed out as bytes.
export { parseCube } from "@videola/media";
export { AudioGraph } from "../src/audio/graph";
export { GeneratorFrames } from "../src/generate/generator";
export { Playback } from "../src/playback";
export { Compositor } from "../src/render/compositor";
export { createContext } from "../src/render/context";
export { blendState, drawList } from "../src/render/draw-list";
export { effect, effectManifests, previewLut, previewValues } from "../src/effects/registry";
export { EffectPreview, referencePicture } from "../src/render/preview";
export { compileProgram, setUniforms } from "../src/render/program";
export { measure, SCOPE_LEVELS, VECTOR_SIZE } from "../src/render/scopes";
