#!/usr/bin/env bash
# Builds the WebAssembly version of the Caissa chess engine used by the web app.
#
#   ./build.sh            fetch Caissa at the pinned commit, patch, build into dist/
#   CAISSA_SRC=<dir> ...  use an existing checkout of that commit (unpatched)
#
# Needs git, curl and Emscripten (em++) on the PATH. The committed files in dist/
# were built with Emscripten 3.1.6 (Ubuntu 24.04 package "emscripten").
set -euo pipefail

CAISSA_REPO="https://github.com/Witek902/Caissa.git"
CAISSA_TAG="2.0"
CAISSA_COMMIT="bb725799e9b19ebdaa0d584f5433fc1c3019e349"
NET_NAME="eval-ml-8-152B-spsa"
NET_URL="https://github.com/Witek902/Caissa-Nets/releases/download/${NET_NAME}/${NET_NAME}.pnn"
NET_SHA256="ee9f6bbb0ef6cd1f38a13cf095340968c2ad18d0fa1359d493043e61acc829fa"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${CAISSA_BUILD_DIR:-$here/.build}"
dist="$here/dist"
mkdir -p "$work" "$dist"

# 1. engine sources at the pinned commit, with the browser patch applied
src="$work/Caissa"
rm -rf "$src"
if [[ -n "${CAISSA_SRC:-}" ]]; then
  git clone --quiet "$CAISSA_SRC" "$src"
else
  git clone --quiet --depth 1 --branch "$CAISSA_TAG" "$CAISSA_REPO" "$src"
fi
git -C "$src" checkout --quiet "$CAISSA_COMMIT"
git -C "$src" apply "$here/caissa-wasm.patch"

# 2. neural network (not embedded: the page loads it once and shares it between engines)
net="$dist/caissa.pnn"
if ! echo "$NET_SHA256  $net" | sha256sum --check --status 2>/dev/null; then
  curl -fsSL --retry 3 -o "$net" "$NET_URL"
  echo "$NET_SHA256  $net" | sha256sum --check --status || { echo "network checksum mismatch" >&2; exit 1; }
fi

# 3. compile: single-threaded, WebAssembly SIMD through the engine's SSE4 code path,
#    Asyncify so that a running search can give control back to the event loop
em++ -std=c++20 -O3 -flto -fno-rtti -fno-math-errno \
  -msimd128 -msse4.2 -DUSE_SSE -DUSE_SSE2 -DUSE_SSE4 -DUSE_POPCNT \
  -DCONFIGURATION_FINAL -DNDEBUG -DCAISSA_VERSION="\"$CAISSA_TAG\"" \
  -include cmath \
  -Wall -Wno-unused-function -Wno-switch -Wno-attributes -Wno-missing-field-initializers \
  -Wno-multichar -Wno-deprecated-declarations \
  -I"$src/src" "$src"/src/backend/*.cpp "$src/src/frontend/UCI.cpp" "$here/wasm_main.cpp" \
  --pre-js "$here/glue.js" --no-entry \
  -sENVIRONMENT=worker,node \
  -sEXPORTED_RUNTIME_METHODS='["ccall"]' \
  -sASYNCIFY=1 -sASYNCIFY_IMPORTS='["caissa_js_yield"]' -sASYNCIFY_STACK_SIZE=1048576 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=2147483648 \
  -sTOTAL_STACK=8388608 \
  -o "$dist/caissa.js"

ls -l "$dist"
