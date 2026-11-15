import type { DbExecutor } from '../worker-kysely';

export interface CacheManifestInput {
	manifestUrl: string;
	manifestJson?: Record<string, any> | null;
	metadata?: Record<string, unknown>;
}

export async function getCachedManifestMetadata(
	db: DbExecutor,
	manifestUrl: string
): Promise<Record<string, unknown> | null> {
	const row = await db
		.selectFrom('iiif_manifest_cache')
		.select('metadata_json')
		.where('manifest_url', '=', manifestUrl)
		.executeTakeFirst();
	return row ? parseCachedManifestMetadata(row.metadata_json) : null;
}

export async function cacheManifest(db: DbExecutor, input: CacheManifestInput): Promise<void> {
	const existing = await getCachedManifestMetadata(db, input.manifestUrl);
	if (!existing && !input.manifestJson && !input.metadata) return;
	const metadata = {
		...existing,
		...input.metadata,
		...(input.manifestJson ? { manifestJson: input.manifestJson } : {}),
	};
	const metadataJson = JSON.stringify(metadata);
	const now = new Date().toISOString();
	await db
		.insertInto('iiif_manifest_cache')
		.values({ manifest_url: input.manifestUrl, metadata_json: metadataJson, fetched_at: now })
		.onConflict(oc =>
			oc.column('manifest_url').doUpdateSet({
				metadata_json: metadataJson,
				...(input.manifestJson ? { fetched_at: now } : {}),
			})
		)
		.execute();
}

export function parseCachedManifestMetadata(value: string | null): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value || '{}');
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
