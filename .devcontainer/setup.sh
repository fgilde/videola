#!/usr/bin/env bash
# Everything a clone needs before `pnpm dev` works, and nothing else.
#
# Three things this machine cannot be assumed to have: pnpm (the repository pins its version in
# package.json, so corepack is the one honest way to get it), wasm-pack (the core compiles to
# WebAssembly and nothing else produces that), and a browser (five of the six harnesses drive a real
# one; without it the unit tests still run and the harnesses say why they cannot).
set -euo pipefail

corepack enable
corepack prepare --activate

if ! command -v wasm-pack >/dev/null 2>&1; then
  curl -sSfL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
fi

# Chromium from the distribution rather than a download: the harnesses look for a browser on PATH, and
# a package the container already knows how to update is worth more than a pinned tarball.
sudo apt-get update -qq
sudo apt-get install -y -qq chromium ffmpeg >/dev/null

pnpm install --frozen-lockfile
pnpm wasm

cat <<'DONE'

Videola is ready.

  pnpm --filter videola-web dev     the editor at http://localhost:5173
  pnpm -r test                      the unit suites
  pnpm --filter @videola/engine test:gpu   the GPU harness, through SwiftShader

The GPU and export harnesses render and encode in software here, so they take minutes rather than
seconds. That is the machine, not a fault.
DONE
