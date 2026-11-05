import {mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// A single atomic envelope keeps the checkpoint and its CAS version together.
export async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(data);
    await file.sync();
    await file.close(); file = undefined;
    await rename(temporary, path);
  } finally {
    await file?.close();
    await rm(temporary, {force: true});
  }
}

export async function openProject(directory, {create = false} = {}) {
  const root = resolve(directory);
  const folder = resolve(root, '.framecraft');
  const path = resolve(folder, 'state.json');
  if (create) await mkdir(folder, {recursive: true});
  const lockPath = resolve(folder, 'lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No Framecraft project at ${root}. Use framecraft create first.`);
    if (error.code === 'EEXIST') throw new Error(`Project is locked: ${lockPath}. If its process has stopped, remove this lock and retry.`);
    throw error;
  }
  const close = async () => { await lock.close(); await rm(lockPath, {force: true}); };
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    let state = null;
    try { state = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (create && state) throw new Error(`A Framecraft project already exists at ${root}.`);
    if (!create && !state) throw new Error(`No saved project at ${root}. Use framecraft create first.`);
    if (state && (state.schemaVersion !== 1 || typeof state.version !== 'string' || !state.snapshot?.projectId)) throw new Error('Invalid Framecraft project state.');
    const projectId = state?.snapshot.projectId ?? randomUUID();
    return {
      root, projectId, close,
      read: () => state,
      async save(snapshot, expectedVersion) {
        if ((state?.version ?? null) !== expectedVersion) throw new Error('Checkpoint version conflict. Reopen the project before saving.');
        const document = JSON.parse(snapshot);
        if (document.schemaVersion !== 1 || document.projectId !== projectId || !Array.isArray(document.files)) throw new Error('Invalid checkpoint.');
        const next = {schemaVersion: 1, version: randomUUID(), snapshot: document};
        await atomicWrite(path, JSON.stringify(next));
        state = next;
        return {version: next.version};
      },
    };
  } catch (error) { await close(); throw error; }
}

export async function writeOutput(path, bytes, {force = false, projectRoot} = {}) {
  path = resolve(path);
  if (projectRoot) {
    const reserved = resolve(projectRoot, '.framecraft');
    if (path === reserved || path.startsWith(reserved + '/')) throw new Error('Output cannot overwrite Framecraft project state.');
  }
  await mkdir(dirname(path), {recursive: true});
  if (force) await atomicWrite(path, bytes);
  else {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    catch (error) { await rm(path, {force: true}); throw error; }
    finally { await file.close(); }
  }
  return {path, bytes: bytes.length};
}
