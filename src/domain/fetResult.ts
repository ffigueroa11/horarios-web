// Interpreta lo que escribe fet-cl: el horario (activities.xml) y el resultado (logs/result.txt).
import type { ActivityKey, Placement, Project } from './types';
import type { FetExport } from './fetExport';
import { findEffectiveGroup, unitById, unitIdOf } from './units';

const unesc = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? unesc(m[1].trim()) : '';
};

/** Lee <nombre>_activities.xml. Se usa regex para funcionar igual en el navegador y en las pruebas. */
export function parseActivitiesXml(xml: string, ex: FetExport): Placement[] {
  const out: Placement[] = [];
  for (const m of xml.matchAll(/<Activity>([\s\S]*?)<\/Activity>/g)) {
    const key = ex.activityById.get(Number(tag(m[1], 'Id')));
    const day = ex.dayNames.indexOf(tag(m[1], 'Day'));
    const periodId = ex.periodByName.get(tag(m[1], 'Hour'));
    if (!key || day < 0 || !periodId) continue;
    out.push({ key, day, periodId, roomId: ex.roomByName.get(tag(m[1], 'Room')) ?? null });
  }
  return out;
}

export type FetOutcome =
  | { kind: 'ok' }
  | { kind: 'impossible'; activity: ActivityKey | null; placedMax: number | null }
  | { kind: 'timeout'; activity: ActivityKey | null; placedMax: number | null }
  | { kind: 'invalid'; details: string };

/** Mensajes de errors.txt / warnings.txt de FET ("Mensaje: ..." en español, "Message: ..." en inglés). */
export function fetMessages(logTxt: string | undefined): string[] {
  if (!logTxt) return [];
  const out: string[] = [];
  for (const block of logTxt.split(/\n\s*\n(?=T[ií]t(?:ulo|le):)/)) {
    const m = /(?:Mensaje|Message):\s*([\s\S]*?)(?=\n(?:Texto bot[oó]n|Button text|Bot[oó]n predefinido|Default button|Presionar|Pressing)|$)/.exec(block);
    if (m) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

export function parseResult(resultTxt: string, ex: FetExport, consoleLines: string[], errorsTxt?: string): FetOutcome {
  // Las palabras clave de result.txt no se traducen; la explicación de FET sí (inglés o español).
  if (/Generation successful/.test(resultTxt)) return { kind: 'ok' };
  // FET indica la actividad más probable de causar el problema: "...listed below:\n\nId: 17 (...)"
  const idm = /(?:listed below|muestra a continuaci[oó]n):\s*Id:\s*(\d+)/.exec(resultTxt);
  const activity = idm ? ex.activityById.get(Number(idm[1])) ?? null : null;
  const pm = /(?:schedule correctly the first|programar correctamente las primeras) (\d+)/.exec(resultTxt);
  const placedMax = pm ? Number(pm[1]) : null;
  if (/Impossible/.test(resultTxt)) return { kind: 'impossible', activity, placedMax };
  if (/Time exceeded|Generation interrupted/.test(resultTxt)) return { kind: 'timeout', activity, placedMax };
  const messages = fetMessages(errorsTxt);
  const details = messages.join('\n\n')
    || consoleLines.filter((l) => !/^FET|^Free timetabling|licensed under|^Starting|^$/.test(l)).join('\n')
    || resultTxt.trim();
  return { kind: 'invalid', details };
}

/** Describe una actividad en el idioma del colegio: "Matemática · 1° Medio A · Prof. Soto (bloque 2 de 4, 2 h)". */
export function describeActivity(p: Project, key: ActivityKey): string {
  const idx = Number(key.split('#')[1]);
  const u = unitById(p).get(unitIdOf(key));
  if (!u) return 'una actividad eliminada';
  const s = p.subjects.find((x) => x.id === u.subjectId)?.name ?? 'Asignatura';
  const who = u.kind === 'electivo'
    ? `electivo de ${u.audience.map((a) => p.courses.find((c) => c.id === a.courseId)?.name ?? 'curso').join(', ')}`
    : u.audience.map((a) => {
      const course = p.courses.find((x) => x.id === a.courseId);
      const grp = findEffectiveGroup(p, course, a.groupId);
      return (course?.name ?? 'curso') + (grp ? ` (${grp.group.name})` : '');
    }).join(', ');
  const t = p.teachers.find((x) => x.id === u.teacherId)?.name;
  const part = u.blocks.length > 1 ? ` (bloque ${idx + 1} de ${u.blocks.length}, ${u.blocks[idx]} h)` : ` (${u.blocks[idx]} h)`;
  return `${s} · ${who}${t ? ' · ' + t : ''}${part}`;
}
