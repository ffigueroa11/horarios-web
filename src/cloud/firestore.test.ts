import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { applyActionCode, connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

vi.mock('./config', () => ({ firebaseConfig: { projectId: 'demo-horarios-web', apiKey: 'demo' } }));
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const apps: FirebaseApp[] = [];

function client(uid?: string, verified = true) {
  const [host, port] = emulator!.split(':');
  if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Se requiere un emulador local.');
  const app = initializeApp({ projectId: 'demo-horarios-web' }, `cliente-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid, email_verified: verified } } : {});
  return db;
}

describe.skipIf(!emulator)('reglas y transacciones de Firestore', () => {
  beforeAll(async () => {
    if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(emulator!)) throw new Error('Se requiere un emulador local.');
    await vi.waitFor(async () => {
      const response = await fetch(`http://${emulator}/v1/projects/demo-horarios-web/databases/(default)/documents/prueba/inicio`);
      expect([403, 404]).toContain(response.status);
    }, { timeout: 60_000, interval: 500 });
  }, 65_000);
  afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
  const path = 'users/ana/projects/horario';
  const data = { revision: 1, schema: 3, data: '{}', updatedAt: serverTimestamp() };

  it('exige sesión, titularidad y correo verificado para leer, escribir y eliminar', async () => {
    for (const db of [client(), client('ana', false), client('bea')]) {
      const ref = doc(db, path);
      for (const operation of [() => getDoc(ref), () => setDoc(ref, data), () => deleteDoc(ref)]) {
        await expect(operation()).rejects.toMatchObject({ code: 'permission-denied' });
      }
    }
  });

  it('valida el esquema, las revisiones y la eliminación lógica y física', async () => {
    const db = client('ana');
    const ref = doc(db, path);
    for (const invalid of [{ revision: 2 }, { schema: 0 }, { data: 1 }, { extra: true }, { updatedAt: 0 }]) {
      await expect(setDoc(ref, { ...data, ...invalid })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    const { cloudBackend } = await import('./firebase');
    const backend = cloudBackend('ana', db);
    const project = { id: ref.id, revision: 1, schema: 3, data: '{}' };
    expect(await backend.put(project)).toBe(true);
    const foreign = doc(client('bea'), path);
    await expect(setDoc(foreign, { ...data, revision: 2 })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(deleteDoc(foreign)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await backend.put(project)).toBe(false);
    await expect(setDoc(ref, data)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await backend.put({ ...project, revision: 2, data: null })).toBe(true);
    expect((await getDoc(ref)).data()?.data).toBeNull();
    await deleteDoc(ref);
    expect((await getDoc(ref)).exists()).toBe(false);
  });

  it('renueva el token al confirmar el correo y elimina los horarios al borrar la cuenta', async () => {
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (!authHost || !/^127\.0\.0\.1:\d+$/.test(authHost)) throw new Error('Falta el emulador local de autenticación.');
    const fb = await import('./firebase');
    const auth = getAuth();
    const url = `http://${authHost}`;
    connectAuthEmulator(auth, url, { disableWarnings: true });
    const db = getFirestore();
    const [host, port] = emulator!.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    const email = 'docente@example.test';
    const password = 'clave-de-prueba';
    const user = await fb.signUp(email, password);
    const backend = fb.cloudBackend(user.uid);
    const project = { id: 'ejemplo', data: '{}', revision: 1, schema: 3 };
    await expect(backend.put(project)).rejects.toMatchObject({ code: 'permission-denied' });
    const response = await fetch(`${url}/emulator/v1/projects/demo-horarios-web/oobCodes`);
    const { oobCodes } = await response.json();
    await applyActionCode(auth, oobCodes.find((entry: { email: string }) => entry.email === email).oobCode);
    expect(await fb.refreshVerified()).toBe(true);
    await fb.logOut();
    expect((await fb.signIn(email, password)).verified).toBe(true);
    expect(await backend.put(project)).toBe(true);
    await fb.deleteAccount(password, () => {});
    expect(auth.currentUser).toBeNull();
    expect((await getDoc(doc(client(user.uid), `users/${user.uid}/projects/ejemplo`))).exists()).toBe(false);
  });
});
