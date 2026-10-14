import { sealDocument, serializeSealedDocument } from './envelope';
import { syncTargetsFile } from './layout';
import { writeTextFileAtomic, type StoreOperationOptions } from './opfs-store';
import type { SyncTargetRecord } from './sync-targets';

export async function writeLegacySyncTargetsFile(
	targets: SyncTargetRecord[],
	options: StoreOperationOptions = {}
): Promise<void> {
	const payload = {
		targets: targets.map(target => ({
			target_id: target.targetId,
			project_id: target.projectId,
			handle_ref: target.handleRef,
			folder_display_path: target.folderDisplayPath,
			enabled: target.enabled,
			connected_at: target.connectedAt,
			updated_at: target.updatedAt,
			last_synced_at: target.lastSyncedAt,
		})),
	};
	const document = await sealDocument('apatosaurus.sync-targets', 1, payload);
	await writeTextFileAtomic(syncTargetsFile(), serializeSealedDocument(document), options);
}
