// PostToolUse (Edit|Write): revisa con oxlint el archivo de src/ recién editado, igual que `npm run lint` en CI.
// Con errores sale con código 2, y Claude recibe el informe para corregirlo.
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const { tool_input: toolInput, cwd } = JSON.parse(input);
const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
const file = relative(root, resolve(root, toolInput?.file_path ?? '')).replaceAll('\\', '/');

if (!/^src\/.+\.(ts|tsx)$/.test(file)) process.exit(0);

const result = spawnSync('npx', ['--no', 'oxlint', file], { cwd: root, encoding: 'utf8', shell: true });
if (result.status !== 0) {
  console.error(`oxlint encontró problemas en ${file}:\n${result.stdout}${result.stderr}`);
  process.exit(2);
}
