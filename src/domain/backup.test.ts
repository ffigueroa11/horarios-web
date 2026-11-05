import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { makeBackup, parseBackup } from './backup';
import { exportFet } from './fetExport';
import { validate } from './validate';

describe('respaldos', () => {
  it('guarda y recupera uno o varios horarios', () => {
    const a = exampleProject(), b = exampleProject();
    expect(parseBackup(makeBackup([a]))[0]).toEqual(a);
    expect(parseBackup(makeBackup([a, b]))).toHaveLength(2);
  });
  it('acepta respaldos de versiones anteriores (sin electivos ni reglas nuevas)', () => {
    const p = exampleProject() as any;
    delete p.electives;
    delete p.rules.teacherMeetingSlots;
    delete p.locks;
    const [back] = parseBackup(JSON.stringify({ app: 'horarios-web', version: 1, project: p }));
    expect(back.electives).toEqual([]);
    expect(back.rules.teacherMeetingSlots).toEqual([]);
    expect(back.locks).toEqual({});
  });
  it('rechaza archivos que no son respaldos con un mensaje claro', () => {
    expect(() => parseBackup('no es json')).toThrow('no es un archivo .json válido');
    expect(() => parseBackup('{"app":"otra"}')).toThrow('otra aplicación');
    expect(() => parseBackup('{"hola":1}')).toThrow('falta la jornada');
    const p = exampleProject() as any;
    p.assignments[0].blocks = ['dos'];
    expect(() => parseBackup(JSON.stringify(p))).toThrow('bloques no válidos');
    expect(() => parseBackup(JSON.stringify({ app: 'horarios-web', version: 99, project: exampleProject() }))).toThrow('versión más nueva');
  });
  // Cada caso hacía fallar a la app después de importar, y el horario dañado quedaba abierto y guardado.
  it.each<[string, (p: any) => void, string]>([
    ['fijado vacío', (p) => { p.locks[`${p.assignments[0].id}#0`] = null; }, 'bloque fijado'],
    ['fijado sin día', (p) => { p.locks[`${p.assignments[0].id}#0`] = { periodId: 'x' }; }, 'bloque fijado'],
    ['divisiones que no son lista', (p) => { p.courses[0].divisions = 'x'; }, 'divisiones'],
    ['grupos que no son lista', (p) => { p.courses[2].divisions[0].groups = 3; }, 'grupos'],
    ['disponibilidad con números', (p) => { p.teachers[0].unavailable = [1, 2]; }, 'disponibilidad'],
    ['tramos cerrados con números', (p) => { p.school.closed = [1]; }, 'tramos sin clases'],
    ['bloques de electivo con texto', (p) => { p.electives[0].blocks = ['x']; }, 'bloques no válidos'],
    ['reglas de bloques que no son lista', (p) => { p.rules.subjectWindows = 'x'; }, 'reglas de bloques'],
    ['consejo con números', (p) => { p.rules.teacherMeetingSlots = [1]; }, 'consejo'],
    ['sala sin nombre', (p) => { p.rooms = [{ id: 'r' }]; }, 'sala'],
    ['carga sin curso', (p) => { delete p.assignments[0].courseId; }, 'carga académica'],
  ])('rechaza con un mensaje claro: %s', (_name, damage, message) => {
    const p = structuredClone(exampleProject());
    damage(p);
    expect(() => parseBackup(JSON.stringify(p))).toThrow(message);
  });
  it('repara lo prescindible y deja un horario que se puede revisar y exportar', () => {
    const p = exampleProject() as any;
    delete p.subjects[0].short;
    delete p.subjects[0].color;
    delete p.school.periods[0].label;
    delete p.courses[0].level;
    p.importReport = 'x';
    p.timetable = { generatedAt: '', seconds: 0, placements: [{ key: 1 }] };
    const [back] = parseBackup(JSON.stringify(p));
    expect(back.timetable).toBeNull();
    expect(back.importReport).toBeUndefined();
    expect(() => { validate(back); exportFet(back); }).not.toThrow();
  });
});
