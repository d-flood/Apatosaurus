import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
} from './envelope';
import { deviceFile } from './layout';
import { readTextFile, writeTextFileAtomic, type StoreOperationOptions } from './opfs-store';
import { invalidShape, quarantineFromError } from './quarantine';

const DEVICE_FORMAT = 'apatosaurus.device';

export interface DeviceIdentity {
	deviceId: string;
	deviceName: string;
}

interface StoredDevice {
	deviceId: string;
	deviceName: string | null;
}

export async function readDeviceIdentity(
	options: StoreOperationOptions = {}
): Promise<DeviceIdentity> {
	let stored = await readStoredDevice(options);
	if (!stored) {
		stored = { deviceId: crypto.randomUUID(), deviceName: null };
		await writeStoredDevice(stored, options);
	}
	return {
		deviceId: stored.deviceId,
		deviceName: stored.deviceName ?? defaultDeviceName(navigator.userAgent),
	};
}

export async function saveDeviceName(
	deviceName: string,
	options: StoreOperationOptions = {}
): Promise<DeviceIdentity> {
	const { deviceId } = await readDeviceIdentity(options);
	await writeStoredDevice({ deviceId, deviceName: deviceName.trim() || null }, options);
	return readDeviceIdentity(options);
}

export function defaultDeviceName(userAgent: string): string {
	return `${browserName(userAgent)} on ${osName(userAgent)}`;
}

function browserName(userAgent: string): string {
	if (/Edg\//.test(userAgent)) return 'Edge';
	if (/OPR\//.test(userAgent)) return 'Opera';
	if (/Firefox\//.test(userAgent)) return 'Firefox';
	if (/Chrome\//.test(userAgent)) return 'Chrome';
	if (/Safari\//.test(userAgent)) return 'Safari';
	return 'Browser';
}

function osName(userAgent: string): string {
	if (/Android/.test(userAgent)) return 'Android';
	if (/iPhone|iPad/.test(userAgent)) return 'iOS';
	if (/Windows/.test(userAgent)) return 'Windows';
	if (/Macintosh|Mac OS X/.test(userAgent)) return 'macOS';
	if (/CrOS/.test(userAgent)) return 'ChromeOS';
	if (/Linux/.test(userAgent)) return 'Linux';
	return 'Unknown OS';
}

async function readStoredDevice(options: StoreOperationOptions): Promise<StoredDevice | null> {
	let raw: string;
	try {
		raw = await readTextFile(deviceFile(), options);
	} catch (error) {
		if (isMissingFileError(error)) return null;
		throw error;
	}
	try {
		const opened = openEnvelope(raw);
		if (opened.header.format !== DEVICE_FORMAT || opened.header.schema_version !== 1) {
			throw invalidShape(`${deviceFile()} is not ${DEVICE_FORMAT} version 1.`);
		}
		await assertEnvelopeHash(opened, DEVICE_FORMAT);
		const { device_id: deviceId, device_name: deviceName } = opened.payload;
		if (typeof deviceId !== 'string' || !deviceId) {
			throw invalidShape('device_id must be a non-empty string.');
		}
		if (deviceName !== null && typeof deviceName !== 'string') {
			throw invalidShape('device_name must be a string or null.');
		}
		return { deviceId, deviceName };
	} catch (error) {
		throw new Error(`Could not read ${deviceFile()}: ${quarantineFromError(error).message}`, {
			cause: error,
		});
	}
}

async function writeStoredDevice(
	device: StoredDevice,
	options: StoreOperationOptions
): Promise<void> {
	const document = await sealDocument(DEVICE_FORMAT, 1, {
		device_id: device.deviceId,
		device_name: device.deviceName,
	});
	await writeTextFileAtomic(deviceFile(), serializeSealedDocument(document), options);
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
