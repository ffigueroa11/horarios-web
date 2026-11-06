// Único archivo que conoce el SDK de Firebase. Se carga bajo demanda: quien no usa una cuenta no descarga el SDK ni se
// conecta a Google.
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword, deleteUser, EmailAuthProvider, getAuth, GoogleAuthProvider, onAuthStateChanged,
  reauthenticateWithCredential, reauthenticateWithPopup, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signOut, type User,
} from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { firebaseConfig } from './config';
import type { CloudBackend, RemoteDoc } from './engine';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'es';
const db = getFirestore(app);

export interface AccountUser {
  uid: string;
  email: string;
  verified: boolean;
  /** Tiene contraseña. Si no, entró solo con Google y se confirma su identidad con Google. */
  hasPassword: boolean;
}

const toUser = (u: User): AccountUser => ({
  uid: u.uid,
  email: u.email ?? '',
  verified: u.emailVerified,
  hasPassword: u.providerData.some((p) => p.providerId === EmailAuthProvider.PROVIDER_ID),
});

export const onUser = (cb: (u: AccountUser | null) => void) => onAuthStateChanged(auth, (u) => cb(u && toUser(u)));

export async function signIn(email: string, password: string): Promise<AccountUser> {
  return toUser((await signInWithEmailAndPassword(auth, email, password)).user);
}

export async function signInWithGoogle(): Promise<AccountUser> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' }); // En un computador compartido, no entrar con la cuenta de otro.
  return toUser((await signInWithPopup(auth, provider)).user);
}

export async function signUp(email: string, password: string): Promise<AccountUser> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(user);
  return toUser(user);
}

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email);
export const logOut = () => signOut(auth);

export async function resendVerification() {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

/** Vuelve a consultar si el correo ya se verificó. Renueva el token, porque las reglas de Firestore leen ese dato de él. */
export async function refreshVerified(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
}

/** Elimina los horarios de la nube y luego la cuenta. Firebase exige una autenticación reciente para hacerlo. */
export async function deleteAccount(password: string | null, onConfirmed: () => void) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('No hay una sesión iniciada.');
  if (password != null) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  else await reauthenticateWithPopup(user, new GoogleAuthProvider());
  onConfirmed();
  if (user.emailVerified) {
    const docs = await getDocs(collection(db, 'users', user.uid, 'projects'));
    await Promise.all(docs.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteUser(user);
}

export function cloudBackend(uid: string): CloudBackend {
  const projects = collection(db, 'users', uid, 'projects');
  return {
    watch: (onDocs, onError) => onSnapshot(projects, { includeMetadataChanges: true }, (snap) => {
      const docs = snap.docChanges().filter((c) => c.type !== 'removed').map((c): RemoteDoc => {
        const d = c.doc.data();
        return { id: c.doc.id, revision: Number(d.revision) || 0, schema: Number(d.schema) || 0, data: typeof d.data === 'string' ? d.data : null };
      });
      onDocs(docs, !snap.metadata.fromCache);
    }, onError),
    put: (d) => runTransaction(db, async (tx) => {
      const ref = doc(projects, d.id);
      const current = await tx.get(ref);
      const revision = current.exists() ? Number(current.data().revision) || 0 : 0;
      if (revision !== d.revision - 1) return false;
      tx.set(ref, { revision: d.revision, schema: d.schema, data: d.data, updatedAt: serverTimestamp() });
      return true;
    }),
  };
}

/** Mensajes en español para lo que puede salir mal al usar la cuenta. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found':
      return 'El correo o la contraseña no son correctos.';
    case 'auth/email-already-in-use': return 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.';
    case 'auth/weak-password': return 'La contraseña es muy débil: usa al menos 6 caracteres.';
    case 'auth/invalid-email': return 'El correo no es válido.';
    case 'auth/too-many-requests': return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
    case 'auth/network-request-failed': return 'No hay conexión. Revisa internet y vuelve a probar.';
    case 'auth/operation-not-allowed': case 'auth/configuration-not-found': return 'Las cuentas todavía no están habilitadas en este sitio.';
    case 'auth/quota-exceeded': return 'Se alcanzó el límite diario de correos. Vuelve a probar mañana.';
    case 'auth/popup-blocked': return 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes de este sitio y vuelve a probar.';
    case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': case 'auth/user-cancelled':
      return 'Se cerró la ventana de Google antes de terminar. Vuelve a probar.';
    case 'auth/unauthorized-domain': return 'Este sitio todavía no está autorizado para entrar con Google.';
    case 'auth/account-exists-with-different-credential': return 'Ya existe una cuenta con ese correo. Entra con tu contraseña.';
    case 'auth/user-mismatch': return 'Elige la misma cuenta de Google con que entraste.';
    default: return `No se pudo completar la operación (${code || (e as Error).message}).`;
  }
}
