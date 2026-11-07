// PreToolUse (Edit|Write|NotebookEdit): impide que Claude edite archivos que no debe tocar a mano.
// Salir con código 2 bloquea la herramienta y entrega el mensaje de stderr a Claude.
import { basename } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const filePath = JSON.parse(input).tool_input?.file_path ?? '';
const name = basename(filePath).toLowerCase();

const reasons = [
  [/^\.env(\..+)?$/.test(name) && name !== '.env.example',
    'contiene la configuración local de Firebase. Edita .env.example o pide al usuario que lo cambie.'],
  [name === 'package-lock.json',
    'solo debe cambiar con npm install / npm uninstall.'],
  [name.endsWith('.fet'),
    'los .fet reales tienen nombres de personas y no van al repositorio. Las pruebas generan sus .fet en memoria.'],
];

const hit = reasons.find(([matches]) => matches);
if (hit) {
  console.error(`Bloqueado: ${basename(filePath)} ${hit[1]}`);
  process.exit(2);
}
