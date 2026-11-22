import { SpeechHistoryEntry, IHistoryStorage } from '../types.js';
import { getHistoryPath } from '../utils/pathUtils.js';
import { ensureDir, fileExists, appendFile, readJsonFile } from '../utils/fileUtils.js';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from "path";
import { promises as fs } from "fs";

/** Append-only file-based history storage using JSON Lines format */
export class HistoryStorage implements IHistoryStorage {
  private readonly filePath = getHistoryPath();

  /** Gets all history entries */
  async getAll(): Promise<SpeechHistoryEntry[]> {

    try {

        const stat = await fs.stat(this.filePath);

        if (!stat.isFile()) {
            return [];
        }

    } catch {

        return [];

    }

    const entries: SpeechHistoryEntry[] = [];

    const stream = createReadStream(this.filePath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as SpeechHistoryEntry);
      } catch { /* skip invalid */ }
    }
    return entries;
  }

  /** Gets a history entry by ID */
  async get(id: string): Promise<SpeechHistoryEntry | undefined> {
    const all = await this.getAll();
    return all.find((e) => e.id === id);
  }

  /** Appends a history entry */
  

async save(entry: SpeechHistoryEntry): Promise<void> {

    await ensureDir(
        path.dirname(this.filePath)
    );

    await appendFile(
        this.filePath,
        JSON.stringify(entry) + "\n"
    );

}

  /** Deletes a history entry by rewriting the file (inefficient but simple) */
  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const filtered = all.filter((e) => e.id !== id);
    const { writeFileAtomic } = await import('../utils/fileUtils.js');
    await writeFileAtomic(this.filePath, filtered.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}