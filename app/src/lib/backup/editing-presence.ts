import { readDeviceIdentity } from '$lib/storage/device-identity';
import { PRESENCE_FOLDER } from '$lib/storage/layout';
import {
	getProjectLocation,
	isPlacedProject,
	listProjectPlacements,
} from '$lib/storage/project-locations';
import { placementSyncContext } from './backup-status';
import { createProviderForLocation } from './provider-factory';
import type { CloudFileMetadata, CloudStorageProvider } from './providers/provider';
import { effectiveAuthorName } from './version-author';
import { editingNotice, type PresenceRecord } from './editing-notice';

interface PresenceTarget {
	provider: CloudStorageProvider;
	projectFolderId: string;
	accountId: string | null;
}

export async function writeEditingPresence(projectId: string, documentId: string): Promise<void> {
	const target = await presenceTarget(projectId);
	if (!target) return;
	const { deviceId, deviceName } = await readDeviceIdentity();
	const record: PresenceRecord = {
		deviceId,
		deviceName,
		author: await effectiveAuthorName(projectId),
		accountId: target.accountId,
		documentId,
		editedAt: new Date().toISOString(),
	};
	const content = JSON.stringify(record, null, 2);
	const presenceFolderId = await target.provider.createFolder(
		PRESENCE_FOLDER,
		target.projectFolderId
	);
	const folderId = await target.provider.createFolder(documentId, presenceFolderId);
	const existing = (await listFolder(target.provider, folderId)).find(
		entry => entry.name === `${deviceId}.json`
	);
	if (existing) await target.provider.updateFile(existing.id, content, existing.revision);
	else await target.provider.createFile(folderId, `${deviceId}.json`, content);
}

export async function clearEditingPresence(projectId: string, documentId: string): Promise<void> {
	const target = await presenceTarget(projectId);
	if (!target) return;
	const { deviceId } = await readDeviceIdentity();
	const own = (await listPresenceFiles(target, documentId)).find(
		entry => entry.name === `${deviceId}.json`
	);
	if (own) await target.provider.deleteFile(own.id);
}

export async function readEditingNotice(
	projectId: string,
	documentId: string
): Promise<string | null> {
	const target = await presenceTarget(projectId);
	if (!target) return null;
	const { deviceId } = await readDeviceIdentity();
	const records = await Promise.all(
		(await listPresenceFiles(target, documentId))
			.filter(entry => entry.name !== `${deviceId}.json`)
			.map(async entry => parsePresence(await target.provider.downloadFile(entry.id)))
	);
	return editingNotice(
		records.filter((record): record is PresenceRecord => record?.documentId === documentId),
		{ deviceId, accountId: target.accountId },
		Date.now()
	);
}

async function presenceTarget(projectId: string): Promise<PresenceTarget | null> {
	const placement = (await listProjectPlacements())
		.filter(isPlacedProject)
		.find(candidate => candidate.projectId === projectId);
	if (!placement) return null;
	const location = await getProjectLocation(placement.locationId);
	if (!location) return null;
	return {
		provider: await createProviderForLocation(location.id),
		projectFolderId: placementSyncContext(placement).cloudFolderId,
		accountId: location.accountId,
	};
}

async function listPresenceFiles(
	target: PresenceTarget,
	documentId: string
): Promise<CloudFileMetadata[]> {
	const presenceFolder = (await listFolder(target.provider, target.projectFolderId)).find(
		entry => entry.isFolder && entry.name === PRESENCE_FOLDER
	);
	if (!presenceFolder) return [];
	const documentFolder = (await listFolder(target.provider, presenceFolder.id)).find(
		entry => entry.isFolder && entry.name === documentId
	);
	if (!documentFolder) return [];
	return (await listFolder(target.provider, documentFolder.id)).filter(
		entry => !entry.isFolder && entry.name.endsWith('.json')
	);
}

async function listFolder(
	provider: CloudStorageProvider,
	folderId: string
): Promise<CloudFileMetadata[]> {
	const entries: CloudFileMetadata[] = [];
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(folderId, { recursive: false, cursor });
		entries.push(...page.entries.filter(entry => !entry.isDeleted));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return entries;
}

function parsePresence(content: string): PresenceRecord | null {
	try {
		const value = JSON.parse(content) as Partial<PresenceRecord>;
		if (
			typeof value.deviceId !== 'string' ||
			typeof value.deviceName !== 'string' ||
			typeof value.documentId !== 'string' ||
			typeof value.editedAt !== 'string' ||
			Number.isNaN(Date.parse(value.editedAt))
		) {
			return null;
		}
		return {
			deviceId: value.deviceId,
			deviceName: value.deviceName,
			author: typeof value.author === 'string' ? value.author : null,
			accountId: typeof value.accountId === 'string' ? value.accountId : null,
			documentId: value.documentId,
			editedAt: value.editedAt,
		};
	} catch {
		return null;
	}
}
