import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { SpeechError } from '../types.js';

/** Computes SHA-256 checksum of a buffer */
export function checksumBuffer(buffer: Buffer, algorithm: 'sha256' | 'md5' = 'sha256'): string {
  return createHash(algorithm).update(buffer).digest('hex');
}

/** Computes SHA-256 checksum of a file */
export function checksumFile(filePath: string, algorithm: 'sha256' | 'md5' = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(new SpeechError(`Failed to checksum file: ${err.message}`, 'CHECKSUM_ERROR')));
  });
}

/** Verifies a buffer against an expected checksum */
export function verifyBufferChecksum(buffer: Buffer, expected: string, algorithm: 'sha256' | 'md5' = 'sha256'): boolean {
  return checksumBuffer(buffer, algorithm) === expected.toLowerCase();
}

/** Verifies a file against an expected checksum */
export async function verifyFileChecksum(filePath: string, expected: string, algorithm: 'sha256' | 'md5' = 'sha256'): Promise<boolean> {
  const actual = await checksumFile(filePath, algorithm);
  return actual === expected.toLowerCase();
}