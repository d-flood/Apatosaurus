import { browser } from '$app/environment';
import {
	discoverLocationProjects,
	emitLocalDbInvalidation,
	listProjects,
	removeProjectsFromDevice,
} from '$lib/db/client';
import { notificationCenter } from '$lib/shell/notification-center.svelte';
import {
	bindPersonalLocation,
	clearRemovedProjects,
	getProjectLocation,
	isPlacedProject,
	listProjectLocations,
	listProjectPlacements,
	listStorageAccounts,
	upsertStorageAccount,
	upsertProjectLocation,
	upsertProjectPlacements,
	type PlacedProject,
	type ProjectLocation,
	type StorageAccount,
} from '$lib/storage/project-locations';
import {
	getDirectoryPicker,
	hasLocalFolderReadWritePermission,
	isLocalFolderProviderSupported,
	persistLocalFolderHandle,
} from './local-folder-handles';
import { browseFolder, type FolderListing } from './folder-browser';
import { ensureLocationMarker, hasLocationMarker, readLocationMarker } from './location-marker';
import { createAccountProvider, createDeviceProvider } from './provider-factory';
import { LOCAL_FOLDER_ROOT_FOLDER_ID } from './providers/local-folder-provider';
import { LOCATION_ROOT_FOLDER_ID } from './providers/provider';
import { GoogleDriveStorageProvider } from './providers/google-drive-provider';
import {
	accountTokens,
	fetchDropboxProfile,
	fetchGoogleProfile,
	issueToken,
	providerLabel,
} from './storage-account-auth';

const PERSONAL_FOLDER = 'Apatosaurus';

export { isLocalFolderProviderSupported };

export async function addDeviceLocation(): Promise<ProjectLocation> {
	const handle = await pickLocalFolderHandle();
	const { marker } = await ensureLocationMarker(
		createDeviceProvider(handle),
		LOCAL_FOLDER_ROOT_FOLDER_ID,
		createId(),
		new Date().toISOString()
	);
	await persistLocalFolderHandle(marker.id, handle);
	const location = await upsertProjectLocation({
		id: marker.id,
		accountId: null,
		kind: 'device',
		rootFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
		displayPath: handle.name || 'Folder on this computer',
	});
	await placeDiscoveredProjects(location.id);
	emitLocalDbInvalidation('sync-targets');
	notificationCenter.upsert({
		id: `location-added-${location.id}`,
		title: 'Folder added',
		message: `Projects in ${location.displayPath} now sync on this device.`,
		tone: 'success',
	});
	return location;
}

export async function completeAccountSignIn(
	accountId: string,
	provider: StorageAccount['provider']
): Promise<ProjectLocation> {
	const token = await issueToken(accountId, provider, true);
	const profile = await (provider === 'google' ? fetchGoogleProfile : fetchDropboxProfile)(
		token.accessToken
	);
	const account = await upsertStorageAccount({
		id: accountId,
		provider,
		displayName: profile.displayName,
		email: profile.email,
		grantedScopes: token.scopes,
		signedIn: true,
		...(profile.rootNamespaceId ? { rootNamespaceId: profile.rootNamespaceId } : {}),
	});
	const rootFolderId = await createPersonalFolder(account, profile.homePath);
	const locations = await listProjectLocations();
	const existing = locations.find(
		location => location.accountId === account.id && location.kind === 'personal'
	);
	const { marker } = await ensureLocationMarker(
		createAccountProvider(account, rootFolderId),
		LOCATION_ROOT_FOLDER_ID,
		existing?.id ?? createId(),
		new Date().toISOString()
	);
	const location = await upsertProjectLocation(
		bindPersonalLocation(
			locations,
			account.id,
			marker.id,
			rootFolderId,
			`${providerLabel(provider)}/${PERSONAL_FOLDER}`
		)
	);
	const accountLocationIds = [
		location.id,
		...locations.filter(other => other.accountId === account.id).map(other => other.id),
	];
	await clearRemovedProjects(accountLocationIds);
	for (const locationId of new Set(accountLocationIds)) await placeDiscoveredProjects(locationId);
	emitLocalDbInvalidation('sync-targets');
	notificationCenter.upsert({
		id: `account-signed-in-${account.id}`,
		title: `${providerLabel(provider)} connected`,
		message: `${account.displayName} (${account.email}) is signed in. Projects in ${location.displayPath} sync on this device.`,
		tone: 'success',
	});
	return location;
}

export async function signOutAccount(accountId: string, removeFromDevice: boolean): Promise<void> {
	const account = (await listStorageAccounts()).find(candidate => candidate.id === accountId);
	if (!account) throw new Error('Storage account was not found.');
	if (removeFromDevice) {
		const locationIds = new Set(
			(await listProjectLocations())
				.filter(location => location.accountId === accountId)
				.map(location => location.id)
		);
		await removeFromThisDevice(
			(await listProjectPlacements())
				.filter(isPlacedProject)
				.filter(placement => locationIds.has(placement.locationId))
		);
	}
	await upsertStorageAccount({ ...account, signedIn: false });
	emitLocalDbInvalidation('sync-targets');
	await fetch('/auth/signout', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ accountId }),
	});
}

export async function removeProjectFromDevice(projectId: string): Promise<void> {
	const placement = (await listProjectPlacements())
		.filter(isPlacedProject)
		.find(candidate => candidate.projectId === projectId);
	if (!placement)
		throw new Error('Only projects with a location can be removed from this device.');
	await removeFromThisDevice([placement]);
}

async function removeFromThisDevice(placements: PlacedProject[]): Promise<void> {
	const result = await removeProjectsFromDevice(placements);
	if (result.ok) return;
	const names = new Map((await listProjects()).map(project => [project.id, project.name]));
	const pending = result.pendingProjectIds.map(id => names.get(id) ?? id).join(', ');
	throw new Error(
		`Changes are still waiting to upload in ${pending}. Wait for them to sync, or keep the projects on this device.`
	);
}

export async function reconnectDeviceLocation(locationId: string): Promise<void> {
	const location = await getProjectLocation(locationId);
	if (!location) throw new Error('Project location was not found.');
	const handle = await pickLocalFolderHandle();
	const marker = await readLocationMarker(createDeviceProvider(handle), location.rootFolderId);
	if (marker?.id !== location.id) {
		throw new Error(`Choose the folder ${location.displayPath} to reconnect this location.`);
	}
	await persistLocalFolderHandle(location.id, handle);
	emitLocalDbInvalidation('sync-targets');
}

export async function placeProjectInLocation(projectId: string, locationId: string): Promise<void> {
	const project = (await listProjects()).find(candidate => candidate.id === projectId);
	if (!project) throw new Error('Project was not found.');
	await upsertProjectPlacements([
		{
			projectId,
			locationId,
			folderName: project.storageSlug,
			needsLocationChoice: false,
		},
	]);
	emitLocalDbInvalidation('sync-targets');
}

export async function dismissPlacementNotice(projectId: string): Promise<void> {
	const placement = (await listProjectPlacements()).find(
		candidate => candidate.projectId === projectId
	);
	if (!placement) return;
	const { moved: _moved, deleted: _deleted, ...rest } = placement;
	await upsertProjectPlacements([{ ...rest, needsLocationChoice: false }]);
	emitLocalDbInvalidation('sync-targets');
}

export async function placeDiscoveredProjects(locationId: string): Promise<void> {
	const [discovered, placements] = await Promise.all([
		discoverLocationProjects(locationId),
		listProjectPlacements(),
	]);
	const placed = new Set(
		placements.filter(placement => placement.locationId).map(placement => placement.projectId)
	);
	await upsertProjectPlacements(
		discovered.projects
			.filter(project => project.imported || !placed.has(project.projectId))
			.map(project => ({
				projectId: project.projectId,
				locationId,
				folderName: project.folderName,
				needsLocationChoice: false,
			}))
	);
}

export async function browseTeamFolders(
	accountId: string,
	folderId: string
): Promise<FolderListing> {
	return browseFolder(createAccountProvider(await signedInAccount(accountId), ''), folderId);
}

export interface GoogleTeamFolder {
	id: string;
	name: string;
	hasMarker: boolean;
}

export async function inspectGoogleTeamFolder(
	accountId: string,
	folderId: string
): Promise<GoogleTeamFolder> {
	const account = await signedInAccount(accountId);
	const folder = await googleDrive(account).describeFolder(folderId);
	return {
		id: folderId,
		name: folder.name,
		hasMarker: await hasLocationMarker(
			createAccountProvider(account, folderId, folder.sharedDriveId),
			LOCATION_ROOT_FOLDER_ID
		),
	};
}

export async function addTeamLocation(
	accountId: string,
	folderId: string
): Promise<ProjectLocation> {
	const account = await signedInAccount(accountId);
	const { rootFolderId, displayPath, sharedDriveId } = await teamRoot(account, folderId);
	const { marker } = await ensureLocationMarker(
		createAccountProvider(account, rootFolderId, sharedDriveId),
		LOCATION_ROOT_FOLDER_ID,
		createId(),
		new Date().toISOString()
	);
	if (await getProjectLocation(marker.id)) {
		throw new Error(`${displayPath} is already a location on this device.`);
	}
	const location = await upsertProjectLocation({
		id: marker.id,
		accountId,
		kind: 'team',
		rootFolderId,
		displayPath,
		...(sharedDriveId ? { sharedDriveId } : {}),
	});
	await placeDiscoveredProjects(location.id);
	emitLocalDbInvalidation('sync-targets');
	notificationCenter.upsert({
		id: `location-added-${location.id}`,
		title: 'Team location added',
		message: `Projects in ${location.displayPath} now sync on this device.`,
		tone: 'success',
	});
	return location;
}

async function teamRoot(
	account: StorageAccount,
	folderId: string
): Promise<Pick<ProjectLocation, 'rootFolderId' | 'displayPath' | 'sharedDriveId'>> {
	if (account.provider === 'dropbox') {
		return { rootFolderId: `/${folderId}`, displayPath: `Dropbox/${folderId}` };
	}
	const folder = await googleDrive(account).describeFolder(folderId);
	return {
		rootFolderId: folderId,
		displayPath: `Google Drive/${folder.name}`,
		sharedDriveId: folder.sharedDriveId,
	};
}

async function signedInAccount(accountId: string): Promise<StorageAccount> {
	const account = (await listStorageAccounts()).find(candidate => candidate.id === accountId);
	if (!account?.signedIn) throw new Error('Sign in to this storage account first.');
	return account;
}

async function createPersonalFolder(account: StorageAccount, homePath = ''): Promise<string> {
	if (account.provider === 'dropbox') {
		const folder = [...homePath.split('/').filter(Boolean), PERSONAL_FOLDER].join('/');
		return `/${await createAccountProvider(account, '').createFolder(folder)}`;
	}
	const myDrive = googleDrive(account);
	return myDrive.folderDriveId(await myDrive.createFolder(PERSONAL_FOLDER));
}

function googleDrive(account: StorageAccount): GoogleDriveStorageProvider {
	return new GoogleDriveStorageProvider({
		driveRootId: 'root',
		tokens: accountTokens(account.id, account.provider),
	});
}

async function pickLocalFolderHandle(): Promise<FileSystemDirectoryHandle> {
	if (!browser || !isLocalFolderProviderSupported()) {
		throw new Error('Folders on this computer are not supported in this browser.');
	}
	const picker = getDirectoryPicker();
	if (!picker) throw new Error('Directory picker is unavailable in this browser.');
	const handle = await picker({ mode: 'readwrite' });
	const granted = await hasLocalFolderReadWritePermission(handle, true);
	if (!granted) throw new Error('Read/write permission was not granted for the selected folder.');
	return handle;
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
