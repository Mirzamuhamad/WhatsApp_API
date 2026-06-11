import fs from 'node:fs/promises';
import path from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';

const fileLocks = new Map();

function fixFileName(file) {
  return file?.replace(/\//g, '__')?.replace(/:/g, '-');
}

async function withFileLock(filePath, operation) {
  const previous = fileLocks.get(filePath) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  fileLocks.set(filePath, current);

  try {
    return await current;
  } finally {
    if (fileLocks.get(filePath) === current) {
      fileLocks.delete(filePath);
    }
  }
}

async function fileExists(filePath) {
  return fs
    .stat(filePath)
    .then((stats) => stats)
    .catch(() => null);
}

export async function resetAuthFolderIfCorrupt(folder, sessionId) {
  const stats = await fileExists(folder);
  if (!stats) {
    await fs.mkdir(folder, { recursive: true });
    return false;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Auth path is not a directory: ${folder}`);
  }

  const files = await fs.readdir(folder, { withFileTypes: true });
  const zeroByteFiles = [];

  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }
    const filePath = path.join(folder, file.name);
    const fileStats = await fs.stat(filePath).catch(() => null);
    if (fileStats?.size === 0) {
      zeroByteFiles.push(file.name);
    }
  }

  if (zeroByteFiles.includes('creds.json') || zeroByteFiles.length > 20) {
    logger.warn(
      { session: sessionId, zeroByteFiles: zeroByteFiles.length },
      'Corrupt WhatsApp auth folder detected; resetting session auth'
    );
    await fs.rm(folder, { recursive: true, force: true });
    await fs.mkdir(folder, { recursive: true });
    return true;
  }

  await Promise.all(
    zeroByteFiles.map((file) => fs.rm(path.join(folder, file), { force: true }).catch(() => {}))
  );
  return zeroByteFiles.length > 0;
}

export async function useAtomicMultiFileAuthState(folder) {
  await fs.mkdir(folder, { recursive: true });

  const writeData = async (data, file) => {
    const filePath = path.join(folder, fixFileName(file));
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    return withFileLock(filePath, async () => {
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      if (!serialized) {
        throw new Error(`Refusing to write empty auth data: ${file}`);
      }

      await fs.writeFile(tmpPath, serialized, 'utf8');
      const stats = await fs.stat(tmpPath);
      if (stats.size === 0) {
        await fs.rm(tmpPath, { force: true });
        throw new Error(`Auth temp file is empty: ${file}`);
      }

      await fs.rename(tmpPath, filePath);
    }).catch(async (error) => {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    });
  };

  const readData = async (file) => {
    const filePath = path.join(folder, fixFileName(file));

    return withFileLock(filePath, async () => {
      try {
        const stats = await fs.stat(filePath);
        if (stats.size === 0) {
          await fs.rm(filePath, { force: true });
          return null;
        }

        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw, BufferJSON.reviver);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn({ file: filePath, error: error.message }, 'Failed to read auth data');
        }
        return null;
      }
    });
  };

  const removeData = async (file) => {
    const filePath = path.join(folder, fixFileName(file));
    return withFileLock(filePath, () => fs.rm(filePath, { force: true }).catch(() => {}));
  };

  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds.json')
  };
}
