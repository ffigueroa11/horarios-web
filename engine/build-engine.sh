#!/usr/bin/env bash
# Compila el motor de FET (fet-cl) a WebAssembly y lo copia a public/engine.
# Probado en Linux (también sirve WSL en Windows). Necesita: git, curl, python3 + pip, cmake, ninja, xz.
# Toma ~15 minutos y ~2,5 GB de RAM.
#
# Además del parche de progreso, se aplican tres ajustes para que el navegador use poca memoria
# (ver engine/README.md): randomSwap partido en funciones, sin inlining fuera de generate.cpp, y
# Binaryen con tope de inlining. Ninguno cambia el resultado: con la misma semilla, el horario es
# idéntico al de FET de escritorio.
set -euo pipefail

FET_VERSION=7.12.0
QT_VERSION=6.11.3
EMSDK_VERSION=4.0.7          # versión de Emscripten que exige Qt 6.11
QT_BASE="${QT_BASE:-}"       # espejo opcional de Qt para aqt (ej. https://qt.mirror.constant.com/)
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HOME/fet-wasm-build}"
mkdir -p "$WORK" && cd "$WORK"

# 1. Código fuente de FET + cambios de Horarios Web
if [ ! -d "fet-$FET_VERSION" ]; then
  [ -f "fet-$FET_VERSION.tar.xz" ] || curl -fLO "https://lalescu.ro/liviu/fet/download/fet-$FET_VERSION.tar.xz"
  tar -xJf "fet-$FET_VERSION.tar.xz"
  (cd "fet-$FET_VERSION" && patch -p1 < "$HERE/fet-web-progress.patch")
  python3 "$HERE/split-randomswap.py" "fet-$FET_VERSION/src/engine/generate.cpp"
  # generate.cpp (la búsqueda) conserva el inlining; el resto se compila sin él (ver más abajo).
  echo 'set_source_files_properties(generate.cpp PROPERTIES COMPILE_OPTIONS "-finline-functions")' \
    >> "fet-$FET_VERSION/src/engine/CMakeLists.txt"
fi

# 2. Qt: versión de escritorio (herramientas del anfitrión) y versión WebAssembly
AQT_BASE=(); [ -n "$QT_BASE" ] && AQT_BASE=(--base "$QT_BASE")
if [ ! -d "Qt/$QT_VERSION/wasm_singlethread" ]; then
  pip install --user --quiet aqtinstall 2>/dev/null || pip install --user --break-system-packages --quiet aqtinstall
  python3 -m aqt install-qt linux desktop "$QT_VERSION" linux_gcc_64 -O Qt "${AQT_BASE[@]}"
  python3 -m aqt install-qt all_os wasm "$QT_VERSION" wasm_singlethread -O Qt "${AQT_BASE[@]}"
  chmod +x "Qt/$QT_VERSION/wasm_singlethread/bin/"*
fi

# 3. Emscripten
if [ ! -d emsdk ]; then git clone https://github.com/emscripten-core/emsdk.git; fi
./emsdk/emsdk install "$EMSDK_VERSION"
./emsdk/emsdk activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source ./emsdk/emsdk_env.sh

# 4. Compilar solo fet-cl (sin interfaz gráfica).
#    -fno-inline-functions: el código que corre una sola vez (leer el archivo, preparar, escribir resultados)
#    queda en funciones pequeñas; generate.cpp lo recupera con -finline-functions (paso 1).
#    El enlace va con -O0 (último -O gana) para que Binaryen no vuelva a fusionar funciones; se optimiza en el paso 5.
cd "fet-$FET_VERSION"
"$WORK/Qt/$QT_VERSION/wasm_singlethread/bin/qt-cmake" -B build-wasm -G Ninja \
  -DCOMMAND_LINE_ONLY=ON -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG -fno-inline-functions" \
  -DCMAKE_EXE_LINKER_FLAGS_RELEASE="-O0 -sASSERTIONS=0" \
  -DQT_HOST_PATH="$WORK/Qt/$QT_VERSION/gcc_64"
cmake --build build-wasm --parallel 2

# 5. Optimizar el .wasm sin fusionar funciones llamadas desde un solo lugar si son grandes.
"$EMSDK/upstream/bin/wasm-opt" build-wasm/src/cl/fet-cl.wasm -O2 --one-caller-inline-max-function-size=300 -o build-wasm/fet-cl.opt.wasm

# 6. Copiar al proyecto
cp build-wasm/src/cl/fet-cl.js "$HERE/../public/engine/fet-cl.js"
cp build-wasm/fet-cl.opt.wasm "$HERE/../public/engine/fet-cl.wasm"

# 7. Traducción oficial al español de los mensajes del motor (la app la carga y usa --language=es)
"$WORK/Qt/$QT_VERSION/gcc_64/bin/lrelease" translations/fet_es.ts -qm "$HERE/../public/engine/fet_es.qm"
echo "Listo: motor copiado a public/engine/ ($(du -h "$HERE/../public/engine/fet-cl.wasm" | cut -f1))"
