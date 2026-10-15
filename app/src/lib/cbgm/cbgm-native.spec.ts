import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
	createCbgmEngine,
	type CbgmEngine,
	type CoherenceSettings,
} from '@apatosaurus/open-cbgm-wasm';
import { beforeAll, expect, it } from 'vitest';

import { nativeCacheMismatch } from './cbgm-native';

const engineDir = new URL('../../../../packages/open-cbgm-wasm/', import.meta.url);

const frozenInput = readFileSync(
	new URL('vendor/open-cbgm-standalone/lib/open-cbgm/examples/3_john_collation.xml', engineDir),
	'utf8'
);

const settings: CoherenceSettings = {
	minExtantUnits: null,
	minExtantProportion: null,
	excludedWitnesses: [],
	classicRules: false,
	mergeSplitReadings: false,
	droppedReadingTypes: [],
	includedCorrectors: [],
};

function nativeDatabase(name: string): Uint8Array {
	return new Uint8Array(
		gunzipSync(readFileSync(new URL(`tests/fixtures/native-import/${name}.db.gz`, engineDir)))
	);
}

let engine: CbgmEngine;

beforeAll(async () => {
	engine = await createCbgmEngine();
});

it('accepts a native database produced for the frozen 3 John input', () => {
	expect(nativeCacheMismatch(engine, frozenInput, settings, nativeDatabase('3-john'))).toBeNull();
});

it('refuses a native database produced from a different input, naming the first mismatch', () => {
	expect(nativeCacheMismatch(engine, frozenInput, settings, nativeDatabase('john-6-23'))).toBe(
		'The database has no witness A.'
	);
});
