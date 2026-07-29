import type { AddressInfo } from 'node:net';
import { app } from '../app';

describe('proxy-aware rate limiting', () => {
  it('ignores spoofed forwarding headers when no proxy is configured', async () => {
    const server = app.listen(0, '127.0.0.1');

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });

      const { port } = server.address() as AddressInfo;
      const statuses: number[] = [];
      for (let request = 0; request < 101; request += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { 'x-forwarded-for': `203.0.113.${request}` },
        });
        statuses.push(response.status);
        await response.arrayBuffer();
      }

      expect(statuses.slice(0, 100)).toEqual(Array(100).fill(200));
      expect(statuses[100]).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
