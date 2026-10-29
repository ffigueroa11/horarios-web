// Descarga de respaldos (.json) de uno o todos los horarios.
import type { Project } from '../domain/types';
import { makeBackup } from '../domain/backup';
import { useProjects } from '../store/projects';
import { downloadText, fileSafe } from './download';

export function downloadBackup(list: Project[]) {
  if (list.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const name = list.length === 1 ? `respaldo-${fileSafe(list[0].name)}-${list[0].year}-${today}.json` : `respaldo-horarios-web-${today}.json`;
  downloadText(name, makeBackup(list), 'application/json');
  try { useProjects.getState().markBackup(list.map((p) => p.id)); } catch { /* la descarga ya se hizo */ }
}
