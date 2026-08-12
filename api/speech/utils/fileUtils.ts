import { promises as fs, createWriteStream, createReadStream } from 'fs';
import { dirname, join } from 'path';
import { SpeechError } from '../types.js';

/** Ensures a directory exists */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    throw new SpeechError(`Failed to create directory ${dirPath}: ${(error as Error).message}`, 'FILESYSTEM_ERROR');
  }
}

/** Writes a file atomically */
export async function writeFileAtomic(filePath: string, data: Buffer | string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  try {
    await ensureDir(dirname(filePath));
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    throw new SpeechError(`Failed to write file ${filePath}: ${(error as Error).message}`, 'FILESYSTEM_ERROR');
  }
}

/** Reads a file as JSON */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error) {
    throw new SpeechError(`Failed to read JSON ${filePath}: ${(error as Error).message}`, 'FILESYSTEM_ERROR');
  }
}

/** Writes a file as JSON */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

/** Checks if a file exists */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Gets file size in bytes */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (error) {
    throw new SpeechError(`Failed to stat file ${filePath}: ${(error as Error).message}`, 'FILESYSTEM_ERROR');
  }
}

/** Deletes a file or directory recursively */
export async function removePath(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch (error) {
    throw new SpeechError(`Failed to remove ${filePath}: ${(error as Error).message}`, 'FILESYSTEM_ERROR');
  }
}

/** Lists files in a directory */
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => join(dirPath, e.name));
  } catch {
    return [];
  }
}

/** Appends to a file */
export async function appendFile(
    filePath: string,
    data: string
): Promise<void> {

    try {

        await ensureDir(dirname(filePath));

        await fs.appendFile(filePath, data);

    } catch (error) {

        throw new SpeechError(
            `Failed to append to ${filePath}: ${(error as Error).message}`,
            "FILESYSTEM_ERROR"
        );

    }

}