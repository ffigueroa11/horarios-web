/** Pie con versión, licencia y enlace al código fuente (exigido por la AGPL). */
export function AppFooter({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`small muted app-footer ${compact ? 'compact' : ''}`}>
      Horarios Web {__APP_VERSION__} · Software libre (<a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL v3</a>)
      {__SOURCE_URL__ && <> · <a href={__SOURCE_URL__} target="_blank" rel="noreferrer">Código fuente</a></>}
      {' · '}<a href="#acerca">Acerca y privacidad</a>
    </p>
  );
}
