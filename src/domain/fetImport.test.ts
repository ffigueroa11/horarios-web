import { describe, expect, it } from 'vitest';
import { exampleProject } from './defaults';
import { exportFet } from './fetExport';
import { FetImportError, parseFet } from './fetImport';
import { activityKey, slotKey } from './types';
import { validate } from './validate';

const activity = (id: number, group: number, dur: number, subject: string, teachers: string[], students: string[], active = true) =>
  `<Activity>${teachers.map((t) => `<Teacher>${t}</Teacher>`).join('')}<Subject>${subject}</Subject>${students.map((s) => `<Students>${s}</Students>`).join('')}<Duration>${dur}</Duration><Id>${id}</Id><Activity_Group_Id>${group}</Activity_Group_Id><Active>${active}</Active></Activity>`;
const fixedAt = (id: number, day: string, hour: string) =>
  `<ConstraintActivityPreferredStartingTime><Weight_Percentage>100</Weight_Percentage><Activity_Id>${id}</Activity_Id><Preferred_Day>${day}</Preferred_Day><Preferred_Hour>${hour}</Preferred_Hour><Permanently_Locked>true</Permanently_Locked><Active>true</Active></ConstraintActivityPreferredStartingTime>`;

/** Archivo con la forma de FET 5: con BOM, horas con horario en el nombre y sin recreos declarados. */
function legacyFet(activities: string, constraints: string, students = '<Year><Name>1°A</Name></Year><Year><Name>1°B</Name></Year>') {
  const hours = ['08:00 - 08:45', '08:45 - 09:30', '09:45 - 10:30', '10:31 - 11:15', '15:30  -16:30'];
  return `﻿<?xml version="1.0" encoding="UTF-8"?>
<fet version="5.23.1">
<Institution_Name>Escuela de prueba</Institution_Name>
<Days_List><Number_of_Days>2</Number_of_Days><Day><Name>Lunes</Name></Day><Day><Name>Martes</Name></Day></Days_List>
<Hours_List><Number_of_Hours>${hours.length}</Number_of_Hours>${hours.map((h) => `<Hour><Name>${h}</Name></Hour>`).join('')}</Hours_List>
<Students_List>${students}</Students_List>
<Teachers_List><Teacher><Name>Soto</Name></Teacher><Teacher><Name>Díaz</Name></Teacher></Teachers_List>
<Subjects_List><Subject><Name>Matemática</Name></Subject><Subject><Name>Planificación</Name></Subject></Subjects_List>
<Activities_List>${activities}</Activities_List>
<Rooms_List></Rooms_List>
<Time_Constraints_List>${constraints}</Time_Constraints_List>
<Space_Constraints_List></Space_Constraints_List>
</fet>`;
}

describe('importar .fet', () => {
  it('rechaza lo que no es un archivo de FET', () => {
    expect(() => parseFet('{"hola":1}')).toThrow(FetImportError);
    expect(() => parseFet('<fet version="5"><Institution_Name>x</Institution_Name></fet>')).toThrow('no tiene días u horas');
  });

  it('deduce los recreos y arma la carga con los bloques fijados', () => {
    const { project: p, report } = parseFet(legacyFet(
      activity(1, 1, 2, 'Matemática', ['Soto'], ['1°A']) + activity(2, 1, 2, 'Matemática', ['Soto'], ['1°A']) + activity(3, 0, 1, 'Matemática', ['Díaz'], ['1°B']),
      fixedAt(1, 'Lunes', '08:00 - 08:45') + fixedAt(2, 'Martes', '09:45 - 10:30'),
    ), 'horario2019.fet');

    expect(p.year).toBe(2019);
    expect(p.name).toBe('horario2019');
    expect(p.school.name).toBe('Escuela de prueba');
    // 09:30-09:45 es recreo, 10:30-10:31 no, y 11:15-15:30 es almuerzo.
    expect(p.school.periods.map((x) => x.kind)).toEqual(['clase', 'clase', 'recreo', 'clase', 'clase', 'almuerzo', 'clase']);
    expect(p.school.periods[6]).toMatchObject({ start: '15:30', end: '16:30' });
    expect(p.courses.map((c) => c.name)).toEqual(['1°A', '1°B']);
    expect(p.assignments.map((a) => a.blocks)).toEqual([[2, 2], [1]]);

    const a = p.assignments[0];
    expect(p.locks[activityKey(a.id, 0)]).toEqual({ day: 0, periodId: p.school.periods[0].id });
    expect(p.locks[activityKey(a.id, 1)]).toEqual({ day: 1, periodId: p.school.periods[3].id });
    expect(Object.keys(p.locks)).toHaveLength(2);
    expect(report.kept.join(' ')).toContain('Carga académica: 3 bloques de clase, 2 con su lugar fijado');
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('no crea un recreo que cruza un bloque fijado, y lo informa', () => {
    const { project: p, report } = parseFet(legacyFet(
      activity(1, 0, 2, 'Matemática', ['Soto'], ['1°A']),
      fixedAt(1, 'Lunes', '08:45 - 09:30'),
    ));
    expect(p.school.periods.map((x) => x.kind)).toEqual(['clase', 'clase', 'clase', 'clase', 'almuerzo', 'clase']);
    expect(report.lost[0]).toContain('El recreo de las 09:30 no se creó');
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('conserva las actividades sin curso y los profesores adicionales como indisponibilidad, y lo informa', () => {
    const { project: p, report } = parseFet(legacyFet(
      activity(1, 0, 2, 'Matemática', ['Soto', 'Díaz'], ['1°A'])
        + activity(2, 0, 2, 'Planificación', ['Soto'], [])
        + activity(3, 0, 1, 'Planificación', ['Díaz'], [])
        + activity(4, 0, 1, 'Matemática', ['Soto'], ['1°B'], false),
      fixedAt(1, 'Lunes', '08:00 - 08:45') + fixedAt(2, 'Martes', '08:00 - 08:45'),
    ));
    const [soto, diaz] = p.teachers;
    const [b1, b2] = p.school.periods;
    expect(p.assignments).toHaveLength(1);
    expect(p.assignments[0].teacherId).toBe(soto.id);
    expect(soto.unavailable).toEqual([slotKey(1, b1.id), slotKey(1, b2.id)]);
    expect(diaz.unavailable).toEqual([slotKey(0, b1.id), slotKey(0, b2.id)]);
    const lost = report.lost.join('\n');
    expect(lost).toContain('1 actividad sin curso (Planificación) quedó solo como bloques');
    expect(lost).toContain('1 actividad sin curso y sin lugar fijado (Planificación) no se importó');
    expect(lost).toContain('1 bloque con más de un profesor');
    expect(lost).toContain('1 actividad desactivada');
  });

  it('marca sin clases los bloques finales usados solo por trabajo sin curso', () => {
    const { project: p, report } = parseFet(legacyFet(
      activity(1, 0, 1, 'Matemática', ['Soto'], ['1°A']) + activity(2, 0, 1, 'Planificación', ['Díaz'], []),
      fixedAt(1, 'Lunes', '08:00 - 08:45') + fixedAt(2, 'Lunes', '15:30  -16:30'),
    ));
    const tarde = p.school.periods[p.school.periods.length - 1];
    expect(p.school.closed).toEqual([slotKey(0, tarde.id), slotKey(1, tarde.id)]);
    expect(report.lost.join(' ')).toContain('1 bloque del final del día');
  });

  it('informa las restricciones que la app no tiene y traduce las que sí', () => {
    const { project: p, report } = parseFet(legacyFet(
      activity(1, 0, 1, 'Matemática', ['Soto'], ['1°A']) + activity(2, 0, 1, 'Matemática', ['Soto'], ['1°A']),
      `<ConstraintBasicCompulsoryTime><Weight_Percentage>100</Weight_Percentage><Active>true</Active></ConstraintBasicCompulsoryTime>
       <ConstraintTwoActivitiesConsecutive><Weight_Percentage>100</Weight_Percentage><First_Activity_Id>1</First_Activity_Id><Second_Activity_Id>2</Second_Activity_Id><Active>true</Active></ConstraintTwoActivitiesConsecutive>
       <ConstraintTwoActivitiesConsecutive><Weight_Percentage>100</Weight_Percentage><First_Activity_Id>1</First_Activity_Id><Second_Activity_Id>2</Second_Activity_Id><Active>false</Active></ConstraintTwoActivitiesConsecutive>
       <ConstraintMinDaysBetweenActivities><Weight_Percentage>95</Weight_Percentage><Number_of_Activities>2</Number_of_Activities><Activity_Id>1</Activity_Id><Activity_Id>2</Activity_Id><MinDays>1</MinDays><Active>true</Active></ConstraintMinDaysBetweenActivities>
       <ConstraintTeacherNotAvailableTimes><Weight_Percentage>100</Weight_Percentage><Teacher>Díaz</Teacher><Number_of_Not_Available_Times>1</Number_of_Not_Available_Times><Not_Available_Time><Day>Martes</Day><Hour>08:00 - 08:45</Hour></Not_Available_Time><Active>true</Active></ConstraintTeacherNotAvailableTimes>
       <ConstraintQueNoExiste><Weight_Percentage>100</Weight_Percentage><Active>true</Active></ConstraintQueNoExiste>`,
    ));
    expect(p.rules).toMatchObject({ spreadSubjectDays: true, spreadStrength: 'preferible', coursesNoGaps: false, coursesStartFirstBlock: false });
    expect(p.teachers[1].unavailable).toEqual([slotKey(1, p.school.periods[0].id)]);
    expect(report.lost).toEqual(['Dos actividades seguidas: 1 restricción no se traspasó.', 'QueNoExiste: 1 restricción no se traspasó.']);
  });

  it('convierte los grupos usados en divisiones, separando los que comparten alumnos', () => {
    const sub = (n: string) => `<Subgroup><Name>${n}</Name></Subgroup>`;
    const students = `<Year><Name>1°A</Name>
      <Group><Name>1°A G1</Name>${sub('x')}${sub('y')}</Group><Group><Name>1°A G2</Name>${sub('z')}${sub('w')}</Group>
      <Group><Name>1°A Ing</Name>${sub('x')}${sub('z')}</Group></Year>`;
    const { project: p, report } = parseFet(legacyFet(
      activity(1, 0, 1, 'Matemática', ['Soto'], ['1°A G1']) + activity(2, 0, 1, 'Matemática', ['Díaz'], ['1°A G2']) + activity(3, 0, 1, 'Matemática', ['Soto'], ['1°A Ing']) + activity(4, 0, 1, 'Matemática', ['Soto'], ['x']),
      '', students,
    ));
    expect(p.courses[0].divisions.map((d) => d.groups.map((g) => g.name))).toEqual([['G1', 'G2'], ['Ing']]);
    expect(p.assignments.filter((a) => a.groupId).length).toBe(4);
    expect(report.lost.join(' ')).toContain('1 clase de subgrupos');
  });

  it('usa los recreos declarados; los de algunos días quedan como tramos sin clases', () => {
    const xml = legacyFet(activity(1, 0, 1, 'Matemática', ['Soto'], ['1°A']), `<ConstraintBreakTimes><Weight_Percentage>100</Weight_Percentage>
      <Break_Time><Day>Lunes</Day><Hour>08:45 - 09:30</Hour></Break_Time><Break_Time><Day>Martes</Day><Hour>08:45 - 09:30</Hour></Break_Time>
      <Break_Time><Day>Martes</Day><Hour>10:31 - 11:15</Hour></Break_Time><Active>true</Active></ConstraintBreakTimes>`);
    const { project: p } = parseFet(xml);
    expect(p.school.periods.map((x) => x.kind)).toEqual(['clase', 'almuerzo', 'clase', 'clase', 'clase']);
    expect(p.school.closed).toEqual([slotKey(1, p.school.periods[3].id)]);
  });

  it('recupera lo que exporta la propia app: jornada, reglas, carga y electivos', () => {
    const src = exampleProject();
    const { project: p } = parseFet(exportFet(src).xml, 'ejemplo.fet');
    expect(p.school.periods.map((x) => [x.start, x.end, x.kind])).toEqual(src.school.periods.map((x) => [x.start, x.end, x.kind]));
    expect(p.school.closed).toHaveLength(src.school.closed.length);
    expect(p.courses.map((c) => c.name)).toEqual(src.courses.map((c) => c.name));
    expect(p.teachers.map((t) => t.name)).toEqual(src.teachers.map((t) => t.name));
    expect(p.subjects.map((s) => s.name)).toEqual(src.subjects.map((s) => s.name));
    expect(p.assignments.map((a) => a.blocks.join('+')).sort()).toEqual(src.assignments.map((a) => a.blocks.join('+')).sort());
    expect(p.electives.map((e) => [e.courseIds.length, e.options.length, e.blocks])).toEqual(src.electives.map((e) => [e.courseIds.length, e.options.length, e.blocks]));
    expect(p.subjects.filter((s) => s.roomId).map((s) => s.name)).toEqual(src.subjects.filter((s) => s.roomId).map((s) => s.name));
    expect(p.rules).toMatchObject({
      coursesNoGaps: src.rules.coursesNoGaps, coursesStartFirstBlock: src.rules.coursesStartFirstBlock,
      teacherMaxGapsPerDay: src.rules.teacherMaxGapsPerDay, spreadSubjectDays: src.rules.spreadSubjectDays, spreadStrength: src.rules.spreadStrength,
    });
    expect(validate(p).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('exportador .fet con bloques fijados', () => {
  it('omite repartir en días una clase con dos bloques fijados el mismo día', () => {
    const p = exampleProject();
    const a = p.assignments.find((x) => x.blocks.length > 1)!;
    const per = p.school.periods.filter((x) => x.kind === 'clase');
    const before = exportFet(p).xml.match(/<ConstraintMinDaysBetweenActivities>/g)!.length;
    p.locks[activityKey(a.id, 0)] = { day: 0, periodId: per[0].id };
    p.locks[activityKey(a.id, 1)] = { day: 0, periodId: per[2].id };
    expect(exportFet(p).xml.match(/<ConstraintMinDaysBetweenActivities>/g)!.length).toBe(before - 1);
  });
});
