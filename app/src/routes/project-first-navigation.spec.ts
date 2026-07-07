import { describe, expect, it } from 'vitest';

import { load as loadCollationList } from './collation/+page';
import { load as loadTranscriptionIgntp } from './transcription/(library)/igntp/+page';
import { load as loadTranscriptionList } from './transcription/(library)/+page';

type TestLoad = (event: { url: URL }) => unknown;

async function expectRedirect(load: TestLoad, location: string, path = '/') {
	try {
		await load({ url: new URL(`https://apatosaurus.test${path}`) });
	} catch (error) {
		expect(error).toMatchObject({ status: 302, location });
		return;
	}
	throw new Error(`Expected redirect to ${location}`);
}

describe('project-first navigation redirects', () => {
	it('redirects the legacy transcription library to the project transcriptions section', async () => {
		await expectRedirect(loadTranscriptionList as TestLoad, '/projects#transcriptions', '/transcription');
	});

	it('redirects the legacy IGNTP import route without a project to the project transcriptions section', async () => {
		await expectRedirect(loadTranscriptionIgntp as TestLoad, '/projects#transcriptions', '/transcription/igntp');
	});

	it('allows the IGNTP import route when a project is explicit', async () => {
		expect((loadTranscriptionIgntp as TestLoad)({ url: new URL('https://apatosaurus.test/transcription/igntp?projectId=p1') })).toEqual({ projectId: 'p1' });
	});

	it('redirects the legacy collation list to the project collations section', async () => {
		await expectRedirect(loadCollationList as TestLoad, '/projects#collations', '/collation');
	});
});
