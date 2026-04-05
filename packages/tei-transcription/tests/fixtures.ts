import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = fileURLToPath(new URL('.', import.meta.url));

export const fixtureDirectory = join(testsDirectory, 'fixtures');

export function fixturePath(name: string): string {
	return join(fixtureDirectory, name);
}

export function readFixture(name: string): string {
	return readFileSync(fixturePath(name), 'utf8');
}
