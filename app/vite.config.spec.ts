import { describe, expect, it } from 'vitest';

import { developmentServer } from './vite.config';

describe('development server configuration', () => {
	it('defaults direct development to loopback port 3160', () => {
		expect(developmentServer({})).toMatchObject({
			host: '127.0.0.1',
			port: 3160,
			strictPort: true,
			allowedHosts: ['localhost'],
		});
	});

	it('uses Devmesh bind, port, and public origin values', () => {
		expect(
			developmentServer({
				DEV_BIND_HOST: '127.0.0.1',
				DEV_PORT: '13160',
				DEV_PUBLIC_ORIGIN: 'https://apatosaurus-dev.example.ts.net',
			})
		).toMatchObject({
			host: '127.0.0.1',
			port: 13160,
			strictPort: true,
			allowedHosts: ['apatosaurus-dev.example.ts.net'],
		});
	});

	it.each(['0', '65536', '13.5', 'not-a-port'])('rejects malformed port %s', port => {
		expect(() => developmentServer({ DEV_PORT: port })).toThrow(/DEV_PORT/);
	});

	it.each([
		'not-an-origin',
		'ftp://example.com',
		'https://user@example.com',
		'https://example.com/path',
	])('rejects malformed public origin %s', origin => {
		expect(() => developmentServer({ DEV_PUBLIC_ORIGIN: origin })).toThrow(/DEV_PUBLIC_ORIGIN/);
	});
});
