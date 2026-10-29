import { describe, expect, it } from 'vitest';
import { emptyProject, exampleProject } from './defaults';
import { applyImport, blocksFromCell, norm, parseDelimited, planImport } from './importCarga';
import { courseLoad, validate } from './validate';

describe('importar carga', () => {
  it('lee texto pegado desde Excel y CSV con comillas', () => {
    expect(parseDelimited('Curso\tAsignatura\n1° A\tMatemática')).toEqual([['Curso', 'Asignatura'], ['1° A', 'Matemática']]);
    expect(parseDelimited('a;"b; c";d')).toEqual([['a', 'b; c', 'd']]);
    expect(parseDelimited('a,"dijo ""hola""",c')).toEqual([['a', 'dijo "hola"', 'c']]);
  });

  it('entiende horas sueltas y bloques', () => {
    expect(blocksFromCell(6, 2)).toEqual([2, 2, 2]);
    expect(blocksFromCell('7 horas', 2)).toEqual([2, 2, 2, 1]);
    expect(blocksFromCell('3', 1)).toEqual([1, 1, 1]);
    expect(blocksFromCell('2+2+1', 2)).toEqual([2, 2, 1]);
    expect(blocksFromCell('mucho', 2)).toBeNull();
  });

  it('compara nombres sin tildes ni variantes de °', () => {
    expect(norm('1º Medio  A')).toBe(norm('1° medio a'));
    expect(norm('Matemática')).toBe(norm('MATEMATICA'));
  });

  it('crea cursos, asignaturas y profesores que faltan', () => {
    const p = emptyProject();
    const plan = planImport(p, [
      ['Curso', 'Asignatura', 'Profesor', 'Horas'],
      ['1° Básico A', 'Lenguaje', 'Ana Torres', 8],
      ['1° Básico A', 'Matemática', 'Ana Torres', '2+2+2'],
      ['1° Básico B', 'Lenguaje', 'Luis Paz', 8],
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.newCourses).toEqual(['1° Básico A', '1° Básico B']);
    expect(plan.newTeachers).toEqual(['Ana Torres', 'Luis Paz']);
    applyImport(p, plan, false);
    expect(p.assignments).toHaveLength(3);
    expect(p.courses[0].level).toBe('1° Básico');
    expect(courseLoad(p, p.courses[0].id)).toBe(14);
  });

  it('reutiliza lo existente, respeta grupos y puede reemplazar la carga', () => {
    const p = exampleProject();
    const before = p.assignments.length;
    const plan = planImport(p, [
      ['curso', 'asignatura', 'docente', 'bloques', 'grupo'],
      ['2º medio a', 'ingles', 'Paula Vera', '2+2', 'avanzado'],
      ['2° Medio A', 'Matemática', 'Andrés Rojas', 7, ''],
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.newCourses).toEqual([]);
    expect(plan.newSubjects).toEqual([]);
    applyImport(p, plan, true);
    const c = p.courses[2];
    const rows = p.assignments.filter((a) => a.courseId === c.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].groupId).toBe(c.divisions[0].groups[1].id);
    expect(p.assignments.length).toBe(before - 10 + 2); // 2° Medio A tenía 10 filas (Artes y Tecnología van en el electivo)
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('informa errores por fila', () => {
    const p = exampleProject();
    const plan = planImport(p, [
      ['Curso', 'Asignatura', 'Profesor', 'Horas', 'Grupo'],
      ['1° Medio A', '', 'X', 2, ''],
      ['1° Medio A', 'Arte', 'X', 'muchas', ''],
      ['1° Medio A', 'Inglés', 'X', 2, 'Intermedio'],
    ]);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(plan.rows).toEqual([]);
  });
});
