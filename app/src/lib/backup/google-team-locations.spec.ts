import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StorageAccount } from '$lib/storage/project-locations';
import { teamLocationAccounts } from './google-team-locations';

const google: StorageAccount = {
	id: 'google:1',
	provider: 'google',
	displayName: 'Ada',
	email: 'ada@example.org',
	grantedScopes: [],
	signedIn: true,
};
const dropbox: StorageAccount = { ...google, id: 'dropbox:dbid:1', provider: 'dropbox' };
const signedOutDropbox: StorageAccount = { ...dropbox, id: 'dropbox:dbid:2', signedIn: false };

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('team location accounts', () => {
	it('does not offer Google while PUBLIC_GOOGLE_TEAM_LOCATIONS is off', () => {
		vi.stubEnv('PUBLIC_GOOGLE_TEAM_LOCATIONS', '');

		expect(teamLocationAccounts([google, dropbox, signedOutDropbox])).toEqual([dropbox]);
	});

	it('offers signed-in Google accounts once the flag is on', () => {
		vi.stubEnv('PUBLIC_GOOGLE_TEAM_LOCATIONS', 'true');

		expect(teamLocationAccounts([google, dropbox, signedOutDropbox])).toEqual([
			google,
			dropbox,
		]);
		expect(teamLocationAccounts([{ ...google, signedIn: false }])).toEqual([]);
	});
});
