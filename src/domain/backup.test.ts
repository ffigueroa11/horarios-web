import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { makeBackup, parseBackup } from './backup';

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
});
