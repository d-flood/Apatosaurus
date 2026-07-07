export type StoragePersistenceStatus = 'granted' | 'denied' | 'unsupported';

export interface StoragePersistenceReport {
	status: StoragePersistenceStatus;
	persisted: boolean;
	canRequest: boolean;
}

export interface StorageEstimateReport {
	usage: number | null;
	quota: number | null;
	usageRatio: number | null;
	isNearQuota: boolean;
}

export interface DurabilityWarningInput {
	hasUserData: boolean;
	persistenceStatus: StoragePersistenceStatus;
	dismissedMilestone: string | null;
	currentMilestone: string;
}

export interface InstallCapabilityReport {
	isInstalled: boolean;
	installSupported: boolean;
}

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let persistRequestedThisSession = false;
let pendingInstallPrompt: BeforeInstallPromptEvent | null = null;

export function getDirectoryPicker():
	| ((options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>)
	| null {
	const maybeGlobal = globalThis as typeof globalThis & {
		showDirectoryPicker?: (options?: {
			mode?: 'read' | 'readwrite';
		}) => Promise<FileSystemDirectoryHandle>;
	};
	return maybeGlobal.showDirectoryPicker ?? null;
}

export function isLocalFolderProviderSupported(): boolean {
	return typeof indexedDB !== 'undefined' && getDirectoryPicker() !== null;
}

export function isOpfsSupported(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

export async function openOriginPrivateFileSystemRoot(): Promise<FileSystemDirectoryHandle> {
	if (!isOpfsSupported()) throw new Error('Origin private file system is unavailable.');
	return navigator.storage.getDirectory();
}

export async function checkStoragePersistence(): Promise<StoragePersistenceReport> {
	const storage = globalThis.navigator?.storage;
	if (typeof storage?.persisted !== 'function') {
		return { status: 'unsupported', persisted: false, canRequest: false };
	}
	const persisted = await storage.persisted();
	return {
		status: persisted ? 'granted' : 'denied',
		persisted,
		canRequest: typeof storage.persist === 'function',
	};
}

export async function requestPersistentStorageForMeaningfulWrite(): Promise<StoragePersistenceReport> {
	if (persistRequestedThisSession) return checkStoragePersistence();
	persistRequestedThisSession = true;
	const storage = globalThis.navigator?.storage;
	if (typeof storage?.persist !== 'function') return checkStoragePersistence();
	await storage.persist().catch(() => false);
	return checkStoragePersistence();
}

export async function getStorageEstimate(): Promise<StorageEstimateReport> {
	const storage = globalThis.navigator?.storage;
	if (typeof storage?.estimate !== 'function') return emptyStorageEstimate();
	const estimate = await storage.estimate();
	const usage = typeof estimate.usage === 'number' ? estimate.usage : null;
	const quota = typeof estimate.quota === 'number' ? estimate.quota : null;
	const usageRatio = usage !== null && quota && quota > 0 ? usage / quota : null;
	return {
		usage,
		quota,
		usageRatio,
		isNearQuota: isStorageNearQuota(usageRatio),
	};
}

export function shouldShowDurabilityWarning(input: DurabilityWarningInput): boolean {
	if (!input.hasUserData) return false;
	if (input.persistenceStatus === 'granted') return false;
	return input.dismissedMilestone !== input.currentMilestone;
}

export function initializeInstallPromptTracking(onChange?: () => void): () => void {
	const handler = (event: Event) => {
		event.preventDefault();
		pendingInstallPrompt = event as BeforeInstallPromptEvent;
		onChange?.();
	};
	globalThis.addEventListener?.('beforeinstallprompt', handler);
	return () => globalThis.removeEventListener?.('beforeinstallprompt', handler);
}

export function getInstallCapabilityReport(): InstallCapabilityReport {
	return {
		isInstalled: isRunningInstalled(),
		installSupported: pendingInstallPrompt !== null,
	};
}

export async function promptForPwaInstall(): Promise<boolean> {
	const prompt = pendingInstallPrompt;
	if (!prompt) return false;
	pendingInstallPrompt = null;
	await prompt.prompt();
	const choice = await prompt.userChoice?.catch(() => null);
	return choice?.outcome === 'accepted';
}

export function isStorageNearQuota(usageRatio: number | null): boolean {
	return usageRatio !== null && usageRatio >= 0.8;
}

export function formatStorageBytes(value: number | null): string {
	if (value === null) return 'Unavailable';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let amount = value;
	let unitIndex = 0;
	while (amount >= 1024 && unitIndex < units.length - 1) {
		amount /= 1024;
		unitIndex += 1;
	}
	return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

export function resetPersistenceRequestSessionForTests(): void {
	persistRequestedThisSession = false;
	pendingInstallPrompt = null;
}

function emptyStorageEstimate(): StorageEstimateReport {
	return { usage: null, quota: null, usageRatio: null, isNearQuota: false };
}

function isRunningInstalled(): boolean {
	const standaloneMedia = globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false;
	const navigatorWithStandalone = globalThis.navigator as Navigator & { standalone?: boolean };
	return standaloneMedia || navigatorWithStandalone?.standalone === true;
}
