import { useState, type FormEvent } from 'react';
import { cloudEnabled } from '../cloud/config';
import {
  adoptAnonProjects, authErrorMessage, checkVerified, deleteAccount, resendVerification, resetPassword, signIn,
  signInWithGoogle, signOut, signUp, skipAdoption, unsyncedCount, useAccount,
} from '../store/account';
import { SyncStatus } from './SyncStatus';
import { useGeneration } from '../store/generation';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const run = async (work: () => Promise<void | string>) => {
    setBusy(true); setError(''); setInfo('');
    try {
      const message = await work();
      if (message) setInfo(message);
    } catch (e) {
      setError(await authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, info, run, setError };
}

function Messages({ error, info }: { error: string; info: string }) {
  return <>
    {error && <div className="notice bad" role="alert">{error}</div>}
    {info && <div className="notice ok" role="status">{info}</div>}
  </>;
}

function SignInForm({ expiredEmail }: { expiredEmail?: string }) {
  const [email, setEmail] = useState(expiredEmail ?? '');
  const [password, setPassword] = useState('');
  const { busy, error, info, run, setError } = useAction();
  const generating = useGeneration((s) => s.status === 'loading' || s.status === 'running');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => signIn(email.trim(), password));
  };
  return (
    <form className="account-form" onSubmit={submit}>
      <div className="row">
        <button type="button" className="btn primary small" disabled={busy || generating} onClick={() => void run(signInWithGoogle)}>Continuar con Google</button>
      </div>
      <p className="small muted">O con tu correo y una contraseña:</p>
      <label className="field"><span>Correo</span>
        <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span>Contraseña</span>
        <input className="input" type="password" autoComplete="current-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <div className="row">
        <button type="submit" className="btn small" disabled={busy || generating}>Iniciar sesión</button>
        {!expiredEmail && <button type="button" className="btn small" disabled={busy || generating} onClick={() => {
          if (!email.trim() || password.length < 6) return setError('Para crear la cuenta, escribe tu correo y una contraseña de al menos 6 caracteres.');
          void run(() => signUp(email.trim(), password));
        }}>Crear cuenta</button>}
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => {
          if (!email.trim()) return setError('Escribe tu correo para enviarte el enlace.');
          void run(async () => { await resetPassword(email.trim()); return 'Si existe una cuenta con ese correo, te enviamos un enlace para cambiar la contraseña.'; });
        }}>Olvidé mi contraseña</button>
      </div>
      {generating && <p className="small muted">Espera a que termine la generación del horario para entrar.</p>}
      <Messages error={error} info={info} />
    </form>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const hasPassword = useAccount((s) => s.hasPassword);
  if (!open) return <button type="button" className="btn small danger" onClick={() => setOpen(true)}>Eliminar mi cuenta</button>;
  return (
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); void run(() => deleteAccount(hasPassword ? password : null)); }}>
      <p>Se eliminarán tu cuenta, tus horarios en la nube y su copia en este navegador. <b>No se puede deshacer</b>: descarga antes un respaldo si quieres conservarlos.</p>
      {hasPassword
        ? <label className="field"><span>Tu contraseña, para confirmar</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        : <p className="small muted">Para confirmar, Google te pedirá elegir tu cuenta.</p>}
      <div className="row">
        <button type="submit" className="btn small danger" disabled={busy}>Eliminar definitivamente</button>
        <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      <Messages error={error} info="" />
    </form>
  );
}

function SignOutButton() {
  const [unsynced, setUnsynced] = useState(0);
  const { busy, error, run } = useAction();
  // Cerrar sesión recarga la página y detendría el cálculo.
  const generating = useGeneration((s) => s.status === 'loading' || s.status === 'running');
  if (unsynced > 0) {
    return (
      <div className="notice warn" role="alert">
        <b>{unsynced === 1 ? 'Un horario tiene cambios' : `${unsynced} horarios tienen cambios`} que no se han subido a tu cuenta.</b>
        <span>Si cierras sesión ahora, esos cambios se perderán. Revisa tu conexión o descarga un respaldo.</span>
        <div className="row">
          <button type="button" className="btn small ghost" onClick={() => setUnsynced(0)}>Seguir conectado</button>
          <button type="button" className="btn small danger" disabled={busy} onClick={() => void run(signOut)}>Cerrar sesión y perderlos</button>
        </div>
        <Messages error={error} info="" />
      </div>
    );
  }
  return <>
    <button type="button" className="btn small" disabled={busy || generating}
      title={generating ? 'Espera a que termine la generación del horario' : undefined} onClick={() => void run(async () => {
      const n = await unsyncedCount();
      if (n > 0) setUnsynced(n);
      else await signOut();
    })}>Cerrar sesión</button>
    <Messages error={error} info="" />
  </>;
}

/** Con quién se entró y cómo salir, en el menú lateral. Sin sesión no muestra nada. */
export function SidebarAccount() {
  const phase = useAccount((s) => s.phase);
  const email = useAccount((s) => s.email);
  if (!cloudEnabled || phase === 'local') return null;
  return (
    <div className="side-account">
      <span title={email}>{email}</span>
      <SignOutButton />
    </div>
  );
}

/** Cuenta opcional en la pantalla de inicio. No aparece si el sitio se publicó sin Firebase. */
export function AccountCard() {
  const { phase, email, sync, syncDetail, anonCount } = useAccount();
  const [showForm, setShowForm] = useState(false);
  const verify = useAction();
  const adopt = useAction();

  if (!cloudEnabled) return null;

  if (phase === 'local') {
    return (
      <section className="card">
        <div className="row"><h2>Guarda tus horarios en una cuenta</h2><span className="spacer" />
          {!showForm && <button type="button" className="btn small" onClick={() => setShowForm(true)}>Iniciar sesión o crear cuenta</button>}</div>
        <p className="small muted">Es opcional. Con una cuenta, tus horarios quedan respaldados y los puedes abrir en otro computador. Sin ella, todo sigue funcionando y nada sale de este navegador.</p>
        {showForm && <>
          <SignInForm />
          <p className="small muted">Al usar una cuenta, tu correo y los datos de tus horarios (incluidos los nombres de los profesores) se guardan en Firebase, un servicio de Google. Ver <a href="#acerca">privacidad</a>.</p>
        </>}
      </section>
    );
  }
  if (phase === 'loading') return <section className="card"><p className="small muted">Revisando tu sesión…</p></section>;
  if (phase === 'expired') {
    return (
      <section className="card">
        <h2>Vuelve a iniciar sesión</h2>
        <p className="small muted">Tu sesión se cerró. Lo que hagas ahora queda en este navegador y se subirá a tu cuenta cuando entres de nuevo.</p>
        <SignInForm expiredEmail={email} />
        <div className="row"><SignOutButton /></div>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="row"><h2>Tu cuenta</h2><span className="spacer" /><span className="small muted">{email}</span></div>
      {phase === 'unverified' ? (
        <div className="notice warn" role="status">
          <b>Confirma tu correo para guardar en tu cuenta.</b>
          <span>Te enviamos un enlace a {email}; revisa también el correo no deseado. Mientras tanto, tus horarios quedan en este navegador.</span>
          <div className="row">
            <button type="button" className="btn small primary" disabled={verify.busy} onClick={() => void verify.run(async () => {
              if (!(await checkVerified())) return 'Todavía no aparece confirmado. Abre el enlace del correo y vuelve a intentar.';
            })}>Ya lo confirmé</button>
            <button type="button" className="btn small ghost" disabled={verify.busy} onClick={() => void verify.run(async () => {
              await resendVerification();
              return 'Te enviamos otro enlace.';
            })}>Reenviar el correo</button>
          </div>
          <Messages error={verify.error} info={verify.info} />
        </div>
      ) : (
        <p className="small"><SyncStatus />
          {sync === 'error' && syncDetail && <span className="muted"> {syncDetail}</span>}</p>
      )}
      {phase === 'ready' && anonCount > 0 && (
        <div className="notice" role="status">
          <span>Este navegador tiene {anonCount === 1 ? 'un horario guardado' : `${anonCount} horarios guardados`} sin cuenta. ¿Son tuyos?</span>
          <div className="row">
            <button type="button" className="btn small primary" disabled={adopt.busy} onClick={() => void adopt.run(adoptAnonProjects)}>Pasarlos a mi cuenta</button>
            <button type="button" className="btn small ghost" disabled={adopt.busy} onClick={skipAdoption}>Dejarlos sin cuenta</button>
          </div>
          <Messages error={adopt.error} info="" />
        </div>
      )}
      <div className="row"><SignOutButton /><span className="spacer" /><DeleteAccount /></div>
      <p className="small muted">Al cerrar sesión, tus horarios se borran de este navegador y siguen en tu cuenta.</p>
    </section>
  );
}
