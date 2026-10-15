import { readFileSync, writeFileSync } from 'node:fs';

import { createCbgmEngine } from '../src/index.ts';

const [input, output] = process.argv.slice(2);
const engine = await createCbgmEngine();
writeFileSync(
	output,
	engine.writeSubstemmata(readFileSync(input), [
		{ witness: '5', ancestors: ['623', '2344'], completedAt: '2026-01-01T00:00:00.000Z' },
		{ witness: 'A', ancestors: [], completedAt: '2026-01-01T00:00:00.000Z' },
	])
);
