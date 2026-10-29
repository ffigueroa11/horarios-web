// Exporta el horario a Excel (.xlsx): una hoja con el listado y una grilla por curso y por profesor.
// La librería se carga solo al exportar, para no pesar en la carga inicial.
import type { Project } from '../domain/types';
import { slotKey } from '../domain/types';
import type { Lesson } from '../domain/manual';
import { findEffectiveGroup } from '../domain/units';
import { downloadBlob, fileSafe } from './download';

type Cell = { value?: string; fontWeight?: 'bold'; wrap?: boolean; alignVertical?: 'top' | 'center'; align?: 'center'; backgroundColor?: string; rowSpan?: number; height?: number; textColor?: string } | null;

function sheetNamer() {
  const used = new Set<string>();
  return (base: string) => {
    const clean = base.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Hoja';
    let n = clean, i = 2;
    while (used.has(n.toLowerCase())) n = `${clean.slice(0, 26)} ${i++}`;
    used.add(n.toLowerCase());
    return n;
  };
}

export async function exportTimetableXlsx(p: Project, all: Lesson[], header: string[], rows: string[][]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const name = sheetNamer();
  const subject = (id: string) => p.subjects.find((s) => s.id === id);
  const teacher = (id: string | null) => p.teachers.find((t) => t.id === id)?.name ?? '';
  const room = (id: string | null) => p.rooms.find((r) => r.id === id)?.name ?? '';
  const courseName = (id: string) => p.courses.find((c) => c.id === id)?.name ?? '';

  const grid = (title: string, covers: (l: Lesson) => boolean, text: (l: Lesson) => string) => {
    const bySlot = new Map<string, Lesson[]>();
    for (const l of all) {
      if (!covers(l)) continue;
      for (let k = 0; k < l.dur; k++) {
        const per = p.school.periods[l.startIdx + k];
        if (per) bySlot.set(slotKey(l.pl.day, per.id), [...(bySlot.get(slotKey(l.pl.day, per.id)) ?? []), l]);
      }
    }
    const data: Cell[][] = [
      [{ value: title, fontWeight: 'bold' }, ...p.school.days.map(() => null)],
      [{ value: 'Bloque', fontWeight: 'bold', backgroundColor: '#e8e4da' }, ...p.school.days.map((d) => ({ value: d, fontWeight: 'bold' as const, align: 'center' as const, backgroundColor: '#e8e4da' }))],
    ];
    const periods = p.school.periods;
    const keyAt = (d: number, i: number) => (bySlot.get(slotKey(d, periods[i].id)) ?? []).map((l) => l.pl.key).sort().join(',');
    periods.forEach((per, i) => {
      if (per.kind !== 'clase') {
        data.push([{ value: `${per.start} ${per.label}`, textColor: '#666666' }, ...p.school.days.map(() => ({ value: '', backgroundColor: '#f2f2f2' }))]);
        return;
      }
      const row: Cell[] = [{ value: `${per.label} ${per.start}–${per.end}`, fontWeight: 'bold', alignVertical: 'top' }];
      p.school.days.forEach((_, d) => {
        const key = keyAt(d, i);
        if (key && i > 0 && periods[i - 1].kind === 'clase' && keyAt(d, i - 1) === key) { row.push(null); return; }
        let span = 1;
        while (key && i + span < periods.length && periods[i + span].kind === 'clase' && keyAt(d, i + span) === key) span++;
        const ls = bySlot.get(slotKey(d, per.id)) ?? [];
        const closed = p.school.closed.includes(slotKey(d, per.id));
        row.push({
          value: closed ? '—' : ls.map(text).join('\n'),
          wrap: true, alignVertical: 'top', rowSpan: span > 1 ? span : undefined,
          backgroundColor: ls.length === 1 ? subject(ls[0].unit.subjectId)?.color : closed ? '#f2f2f2' : undefined,
          textColor: ls.length === 1 ? '#ffffff' : undefined,
        });
      });
      data.push(row);
    });
    return data;
  };

  const groupOf = (l: Lesson, courseId: string) => {
    if (l.unit.kind === 'electivo') return p.electives.find((e) => e.id === l.unit.electiveId)?.name ?? '';
    const a = l.unit.audience.find((x) => x.courseId === courseId);
    return a ? findEffectiveGroup(p, p.courses.find((c) => c.id === courseId), a.groupId)?.group.name ?? '' : '';
  };
  const columns = [{ width: 16 }, ...p.school.days.map(() => ({ width: 24 }))];

  const sheets = [
    {
      sheet: name('Listado'),
      data: [header.map((h) => ({ value: h, fontWeight: 'bold' as const })), ...rows.map((r) => r.map((value) => ({ value })))],
      columns: [{ width: 16 }, { width: 14 }, { width: 11 }, { width: 8 }, { width: 8 }, { width: 24 }, { width: 22 }, { width: 16 }],
      stickyRowsCount: 1,
    },
    ...p.courses.map((c) => ({
      sheet: name(c.name),
      columns,
      orientation: 'landscape' as const,
      data: grid(`${c.name} — ${p.school.name || p.name} ${p.year}`, (l) => l.unit.audience.some((a) => a.courseId === c.id), (l) => {
        const g = groupOf(l, c.id);
        return [subject(l.unit.subjectId)?.name, g && `(${g})`, teacher(l.unit.teacherId), room(l.pl.roomId)].filter(Boolean).join(' · ');
      }),
    })),
    ...p.teachers.filter((t) => all.some((l) => l.unit.teacherId === t.id)).map((t) => ({
      sheet: name(`Prof. ${t.name}`),
      columns,
      orientation: 'landscape' as const,
      data: grid(`${t.name} — ${p.school.name || p.name} ${p.year}`, (l) => l.unit.teacherId === t.id, (l) =>
        [subject(l.unit.subjectId)?.name, [...new Set(l.unit.audience.map((a) => courseName(a.courseId)))].join(', '), room(l.pl.roomId)].filter(Boolean).join(' · ')),
    })),
  ];
  const blob = await writeXlsxFile(sheets as Parameters<typeof writeXlsxFile>[0] & unknown[]).toBlob();
  downloadBlob(`horario-${fileSafe(p.name)}.xlsx`, blob);
}
