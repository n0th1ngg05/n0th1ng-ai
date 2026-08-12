import { request, RequestOptions } from 'http';
import { SpeechError } from '../types.js';

/** HTTP client for runtime communication */
export class HttpClient {
  constructor(private readonly baseUrl: string) {}

  /** Performs a GET request */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Performs a POST request */
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** Performs a DELETE request */
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  protected request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options: RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      };

      const req = request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data) as T);
            } else {
              reject(new SpeechError(`HTTP ${res.statusCode}: ${data}`, 'HTTP_ERROR'));
            }
          } catch {
            reject(new SpeechError('Invalid JSON response', 'HTTP_ERROR'));
          }
        });
      });

      req.on('error', (err) => {
        reject(new SpeechError(`HTTP request failed: ${err.message}`, 'HTTP_ERROR'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}