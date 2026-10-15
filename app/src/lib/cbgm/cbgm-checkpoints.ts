import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';

import { isMissingStoreEntryError } from '$lib/backup/project-archive';
import { cbgmCheckpointFolder, cbgmCheckpointsFolder, joinStorePath } from '$lib/storage/layout';
import {
	deleteDirectory,
	listDirectory,
	readFileBytes,
	readTextFile,
	writeFileBytesAtomic,
	writeTextFileAtomic,
	type StoreBackend,
	type StoreDirectoryEntry,
} from '$lib/storage/opfs-store';
import type { CbgmComputationRequest, ComputationPhase } from './cbgm-scheduler.svelte';
import type { SubstemmaRow } from './cbgm-worker-types';

export type CbgmQueueEntry = { request: CbgmComputationRequest; order: number };
export type WitnessResult = Uint8Array | SubstemmaRow;
type CheckpointKey = { analysisId: string; phase: ComputationPhase };

type StoredRequest = {
	analysisId: string;
	projectId: string;
	phase: ComputationPhase;
	settings: CoherenceSettings;
	notifyOs: boolean;
	order: number;
};

const REQUEST_FILE = 'request.json';
const INPUT_FILE = 'input.xml';
const CACHE_FILE = 'cache.sqlite';
const WITNESSES_FOLDER = 'witnesses';
const ROWS_SUFFIX = '.rows';
const SUBSTEMMA_SUFFIX = '.json';

export type CbgmCheckpoints = ReturnType<typeof cbgmCheckpoints>;

export function cbgmCheckpoints(backend?: StoreBackend) {
	const options = backend ? { backend } : {};
	const file = ({ analysisId, phase }: CheckpointKey, ...path: string[]) =>
		joinStorePath(cbgmCheckpointFolder(analysisId, phase), ...path);

	async function list(path: string): Promise<StoreDirectoryEntry[]> {
		try {
			return await listDirectory(path, options);
		} catch (error) {
			if (isMissingStoreEntryError(error)) return [];
			throw error;
		}
	}

	async function load(folder: string): Promise<CbgmQueueEntry | null> {
		let stored: StoredRequest;
		try {
			stored = JSON.parse(await readTextFile(joinStorePath(folder, REQUEST_FILE), options));
		} catch (error) {
			if (isMissingStoreEntryError(error)) return null;
			throw error;
		}
		const { order, phase, ...request } = stored;
		return {
			order,
			request:
				phase === 'coherence'
					? {
							...request,
							phase,
							inputTei: await readTextFile(
								joinStorePath(folder, INPUT_FILE),
								options
							),
						}
					: {
							...request,
							phase,
							cache: await readFileBytes(joinStorePath(folder, CACHE_FILE), options),
						},
		};
	}

	return {
		async list(): Promise<CbgmQueueEntry[]> {
			const folders = await list(cbgmCheckpointsFolder());
			const entries = await Promise.all(
				folders
					.filter(folder => folder.kind === 'directory')
					.map(folder => load(folder.path))
			);
			return entries
				.filter(entry => entry !== null)
				.sort((left, right) => left.order - right.order);
		},

		async save({ request, order }: CbgmQueueEntry): Promise<void> {
			const { analysisId, projectId, phase, settings, notifyOs } = request;
			if (request.phase === 'coherence')
				await writeTextFileAtomic(file(request, INPUT_FILE), request.inputTei, options);
			else await writeFileBytesAtomic(file(request, CACHE_FILE), request.cache, options);
			const stored = { analysisId, projectId, phase, settings, notifyOs, order };
			await writeTextFileAtomic(file(request, REQUEST_FILE), JSON.stringify(stored), options);
		},

		async loadResults(key: CheckpointKey): Promise<Map<string, WitnessResult>> {
			const results = new Map<string, WitnessResult>();
			for (const entry of await list(file(key, WITNESSES_FOLDER))) {
				if (entry.name.endsWith(ROWS_SUFFIX)) {
					const siglum = decodeURIComponent(entry.name.slice(0, -ROWS_SUFFIX.length));
					results.set(siglum, await readFileBytes(entry.path, options));
				} else if (entry.name.endsWith(SUBSTEMMA_SUFFIX)) {
					const row: SubstemmaRow = JSON.parse(await readTextFile(entry.path, options));
					results.set(row.witness, row);
				}
			}
			return results;
		},

		saveResult(key: CheckpointKey, siglum: string, result: WitnessResult): Promise<void> {
			const stem = encodeURIComponent(siglum);
			return result instanceof Uint8Array
				? writeFileBytesAtomic(
						file(key, WITNESSES_FOLDER, `${stem}${ROWS_SUFFIX}`),
						result,
						options
					)
				: writeTextFileAtomic(
						file(key, WITNESSES_FOLDER, `${stem}${SUBSTEMMA_SUFFIX}`),
						JSON.stringify(result),
						options
					);
		},

		async clear(key: CheckpointKey): Promise<void> {
			try {
				await deleteDirectory(file(key), { ...options, recursive: true });
			} catch (error) {
				if (!isMissingStoreEntryError(error)) throw error;
			}
		},
	};
}
