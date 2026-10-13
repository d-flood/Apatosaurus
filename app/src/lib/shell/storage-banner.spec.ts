import { describe, expect, it } from 'vitest';
import type {
	ProjectLocation,
	ProjectPlacement,
	StorageAccount,
} from '$lib/storage/project-locations';
import { deriveStorageBanner } from './storage-banner';

const google: StorageAccount = {
	id: 'google:ada',
	provider: 'google',
	displayName: 'Ada',
	email: 'ada@example.com',
	grantedScopes: [],
	signedIn: true,
};
const dropbox: StorageAccount = {
	id: 'dropbox:ada',
	provider: 'dropbox',
	displayName: 'Ada',
	email: 'ada@example.com',
	grantedScopes: [],
	signedIn: true,
};
const locations: ProjectLocation[] = [
	{
		id: 'google-home',
		accountId: google.id,
		kind: 'personal',
		rootFolderId: 'g',
		displayPath: 'Google Drive/Apatosaurus',
	},
	{
		id: 'dropbox-home',
		accountId: dropbox.id,
		kind: 'personal',
		rootFolderId: 'd',
		displayPath: 'Dropbox/Apatosaurus',
	},
	{
		id: 'folder',
		accountId: null,
		kind: 'device',
		rootFolderId: 'f',
		displayPath: 'Scholarship',
	},
];

function placed(projectId: string, locationId: string): ProjectPlacement {
	return { projectId, locationId, folderName: projectId, needsLocationChoice: false };
}

function browserOnly(projectId: string, notice: Partial<ProjectPlacement> = {}): ProjectPlacement {
	return { projectId, locationId: null, folderName: null, needsLocationChoice: false, ...notice };
}

function banner(
	input: Partial<Parameters<typeof deriveStorageBanner>[0]> &
		Pick<Parameters<typeof deriveStorageBanner>[0], 'placements' | 'accounts'>
) {
	return deriveStorageBanner({
		projectIds: input.placements.map(placement => placement.projectId),
		locations,
		reconnectAccountIds: new Set(),
		dismissed: false,
		...input,
	});
}

describe('deriveStorageBanner', () => {
	it('chooses signed-out over reconnect over sign-in when all hold at once', () => {
		const placements = [
			placed('in-google', 'google-home'),
			placed('in-dropbox', 'dropbox-home'),
			browserOnly('loose'),
		];
		const signedOutGoogle = { ...google, signedIn: false };
		const reconnectAccountIds = new Set([dropbox.id]);

		expect(
			banner({ placements, accounts: [dropbox, signedOutGoogle], reconnectAccountIds })
		).toEqual({ kind: 'signed-out', account: signedOutGoogle });
		expect(banner({ placements, accounts: [google, dropbox], reconnectAccountIds })).toEqual({
			kind: 'reconnect',
			account: dropbox,
		});
		expect(
			banner({
				placements,
				accounts: [signedOutGoogle, { ...dropbox, signedIn: false }],
				projectIds: ['loose'],
			})
		).toEqual({ kind: 'sign-in', count: 1 });
	});

	it('shows signed-out only while the account still has projects on this device', () => {
		const signedOutGoogle = { ...google, signedIn: false };
		const placements = [placed('in-google', 'google-home')];

		expect(banner({ placements, accounts: [signedOutGoogle] })).toEqual({
			kind: 'signed-out',
			account: signedOutGoogle,
		});
		expect(banner({ placements, accounts: [signedOutGoogle], projectIds: [] })).toBeNull();
	});

	it('never lets dismissal hide signed-out or reconnect', () => {
		const placements = [placed('in-google', 'google-home'), browserOnly('loose')];

		expect(
			banner({ placements, accounts: [{ ...google, signedIn: false }], dismissed: true })
		).toMatchObject({ kind: 'signed-out' });
		expect(
			banner({
				placements,
				accounts: [google],
				reconnectAccountIds: new Set([google.id]),
				dismissed: true,
			})
		).toMatchObject({ kind: 'reconnect' });
		expect(banner({ placements, accounts: [], dismissed: true })).toBeNull();
	});

	it('never counts moved, deleted or folder-on-this-computer projects as not backed up', () => {
		const placements = [
			browserOnly('moved', {
				moved: { movedAt: '2026-10-01', movedBy: 'Ada', destinationLabel: 'Dropbox' },
			}),
			browserOnly('deleted', { deleted: { deletedAt: '2026-10-01', deletedBy: 'Ada' } }),
			placed('in-folder', 'folder'),
		];

		expect(banner({ placements, accounts: [] })).toBeNull();
		expect(banner({ placements: [...placements, browserOnly('loose')], accounts: [] })).toEqual(
			{ kind: 'sign-in', count: 1 }
		);
	});

	it('asks a browser-only project with no content, or no placement yet, to sign in', () => {
		expect(banner({ placements: [], accounts: [], projectIds: ['fresh'] })).toEqual({
			kind: 'sign-in',
			count: 1,
		});
		expect(
			banner({
				placements: [browserOnly('alpha', { needsLocationChoice: true })],
				accounts: [],
			})
		).toEqual({ kind: 'sign-in', count: 1 });
	});

	it('leaves not-backed-up projects without a banner once an account is signed in', () => {
		expect(banner({ placements: [browserOnly('loose')], accounts: [google] })).toBeNull();
	});
});
