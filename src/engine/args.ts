// Argumentos de fet-cl. Solo se pide el XML del horario: las tablas HTML de FET no se usan
// y escribirlas cuesta más que la búsqueda en colegios chicos.
export const FET_BASENAME = 'horario';
export const FET_IN = `/work/in/${FET_BASENAME}.fet`;
export const FET_OUT = '/work/out';

export function fetArgs(timeLimitSeconds: number, seed?: number): string[] {
  const args = [
    `--inputfile=${FET_IN}`,
    `--outputdir=${FET_OUT}`,
    `--timelimitseconds=${Math.max(1, Math.round(timeLimitSeconds))}`,
    '--htmllevel=0',
    '--writetimetableconflicts=false',
    '--writetimetablesstatistics=false',
    '--writetimetablesdayshorizontal=false',
    '--writetimetablesdaysvertical=false',
    '--writetimetablestimehorizontal=false',
    '--writetimetablestimevertical=false',
    '--writetimetablessubgroups=false',
    '--writetimetablesgroups=false',
    '--writetimetablesyears=false',
    '--writetimetablesteachers=false',
    '--writetimetablesteachersfreeperiods=false',
    '--writetimetablesbuildings=false',
    '--writetimetablesrooms=false',
    '--writetimetablessubjects=false',
    '--writetimetablesactivitytags=false',
    // writetimetablesactivities se deja activo: controla también <nombre>_activities.xml, que es el que se lee.
    '--warnifusinggroupactivitiesininitialorder=false',
    '--warnsubgroupswiththesameactivities=false',
  ];
  if (seed != null) {
    // Seis componentes derivados de una sola semilla: misma semilla = mismo horario.
    const a = (seed % 4000000000) + 1;
    args.push(`--randomseeds10=${a}`, `--randomseeds11=${a + 7}`, `--randomseeds12=${a + 13}`,
      `--randomseeds20=${a + 17}`, `--randomseeds21=${a + 19}`, `--randomseeds22=${a + 23}`);
  }
  return args;
}

/** Archivos de salida que interesan, relativos a FET_OUT. */
export const KEEP_OUTPUT = /(_activities\.xml|logs\/result\.txt|logs\/warnings\.txt|logs\/errors\.txt)$/;
