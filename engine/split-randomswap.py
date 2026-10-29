#!/usr/bin/env python3
"""
Parte Generate::randomSwap (≈30.000 líneas en src/engine/generate.cpp) en funciones más pequeñas.

Motivo: en el navegador, el compilador optimizador de WebAssembly (TurboFan, en Chrome/Edge) necesita
memoria que crece mucho más rápido que el tamaño de la función: optimizar randomSwap entero costaba
~460 MB y ~5 s. Funciones de unas decenas de KB cuestan unos pocos MB cada una.

Cómo: randomSwap es una secuencia de secciones con el mismo patrón

        okX=true;
        ... revisa la restricción; si falla: okX=false; goto impossibleX; ...
    impossibleX:
        if(!okX){ ...; continue; }

Cada sección grande se envuelve en una lambda `noinline` que captura todo por referencia, y su propio
`goto impossibleX;` pasa a ser `return;`. El código, el orden de las operaciones y el uso del generador
aleatorio no cambian: con la misma semilla el horario es idéntico al de FET original.

Uso: split-randomswap.py generate.cpp [--min-lines N] [--skip label1,label2]
"""
import re
import sys

LABEL = re.compile(r'^(impossible\w+):\s*$')
CHECK = re.compile(r'^\t\tif\(!(ok\w+)\)\{\s*$')
ANY_LABEL = re.compile(r'^\s*(impossible\w+|again_if_impossible_activity):\s*$')
GOTO = re.compile(r'goto\s+(\w+)\s*;')


def main():
    path = sys.argv[1]
    min_lines = 40
    skip = set()
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == '--min-lines':
            min_lines = int(args[i + 1])
        if a == '--skip':
            skip = set(x for x in args[i + 1].split(',') if x)

    lines = open(path, encoding='utf-8').read().split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('void Generate::randomSwap(int ai, int level){'))
    end = next(i for i in range(start + 1, len(lines)) if lines[i] == '}')

    sections = []  # (inicio, línea de la etiqueta, etiqueta)
    prev_label = start
    for li in range(start, end):
        m = LABEL.match(lines[li])
        if not m:
            continue
        label = m.group(1)
        c = CHECK.match(lines[li + 1]) if li + 1 < end else None
        if c:
            var = c.group(1)
            s = next((k for k in range(li - 1, prev_label, -1) if lines[k] == f'\t\t{var}=true;'), None)
            if s is not None:
                body = lines[s:li]
                gotos = set(GOTO.findall('\n'.join(body)))
                ok = (
                    label not in skip
                    and len(body) >= min_lines
                    and gotos <= {label}
                    and not any(ANY_LABEL.match(b) for b in body)
                )
                if ok:
                    sections.append((s, li, label))
        prev_label = li

    out = lines[:]
    for s, li, label in reversed(sections):
        body = [re.sub(rf'goto\s+{label}\s*;', 'return;', b) for b in out[s:li]]
        out[s:li] = ['\t\t[&]() __attribute__((noinline)) { //FET-web: sección separada (ver split-randomswap.py)'] + body + ['\t\t}();']

    open(path, 'w', encoding='utf-8').write('\n'.join(out))
    print(f'randomSwap: {end - start} líneas, {len(sections)} secciones separadas')


if __name__ == '__main__':
    main()
