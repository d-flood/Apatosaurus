import type { ProjectLocation } from '$lib/storage/project-locations';

const LAST_USED_LOCATION_STORAGE_KEY = 'lastUsedLocationId';

export function readLastUsedLocationId(): string | null {
	try {
		return globalThis.localStorage?.getItem(LAST_USED_LOCATION_STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}

export function recordLastUsedLocation(id: string): void {
	try {
		globalThis.localStorage?.setItem(LAST_USED_LOCATION_STORAGE_KEY, id);
	} catch {
		return;
	}
}

export function resolveDefaultLocationId(
	storedId: string | null,
	locations: readonly Pick<ProjectLocation, 'id' | 'kind'>[]
): string | null {
	if (storedId && locations.some(location => location.id === storedId)) return storedId;
	return (locations.find(location => location.kind === 'personal') ?? locations[0])?.id ?? null;
}
