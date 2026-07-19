<script lang="ts">
	import { version } from '$app/environment';
	import {
		checkStoragePersistence,
		getStorageEstimate,
		shouldShowDurabilityWarning,
		type StorageEstimateReport,
		type StoragePersistenceReport,
	} from '$lib/client/capabilities';
	import {
		deriveProjectBackupSummary,
		getCollationVersionStatus,
		getProjectTranscriptionStatusForOwnedTranscription,
		listCollationsWithProjectNames,
		listProjects,
		listTranscriptionSummaries,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import type { CollationListItem } from '$lib/client/db/repositories/collations';
	import type { ProjectOption } from '$lib/client/db/repositories/projects';
	import type { TranscriptionSummary } from '$lib/client/db/repositories/transcriptions';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		readLastOpenedProjectId,
		resolveLastOpenedProjectId,
	} from '$lib/client/navigation/last-opened-project';
	import { listSyncTargets, type SyncTargetRecord } from '$lib/client/store';
	import { LOCAL_FOLDER_ROOT_FOLDER_ID } from '$lib/client/sync/providers/local-folder-provider';
	import type { ProjectBackupSummary } from '$lib/client/sync/sync-manager';
	import Dashboard, {
		type DashboardAttentionItem,
		type DashboardDocument,
	} from '$lib/components/Dashboard.svelte';
	import { onMount } from 'svelte';

	type RecentSummary =
		| { type: 'Transcription'; id: string; updatedAt: string; summary: TranscriptionSummary }
		| { type: 'Collation'; id: string; updatedAt: string; summary: CollationListItem };

	let projects = $state.raw<ProjectOption[]>([]);
	let lastOpenedProject = $state<ProjectOption | null>(null);
	let recentDocuments = $state.raw<DashboardDocument[]>([]);
	let attentionItems = $state.raw<DashboardAttentionItem[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let loadRunId = 0;

	async function loadDashboard() {
		const runId = ++loadRunId;
		isLoading = true;
		try {
			await ensureLocalDbRuntime();
			const [projectRows, transcriptionRows, collationRows, persistence, estimate, targets] =
				await Promise.all([
					listProjects(),
					listTranscriptionSummaries(),
					listCollationsWithProjectNames(),
					checkStoragePersistence(),
					getStorageEstimate(),
					listSyncTargets(),
				]);
			const recentRows = mergeRecentSummaries(transcriptionRows, collationRows);
			const [documents, warnings] = await Promise.all([
				enrichRecentDocuments(recentRows),
				buildAttentionItems(projectRows, targets, persistence, estimate),
			]);
			if (runId !== loadRunId) return;

			projects = projectRows;
			const targetId = resolveLastOpenedProjectId(readLastOpenedProjectId(), projectRows);
			lastOpenedProject = projectRows.find(project => project.id === targetId) ?? null;
			recentDocuments = documents;
			attentionItems = warnings;
			error = null;
		} catch (cause) {
			if (runId !== loadRunId) return;
			error = cause instanceof Error ? cause.message : 'Failed to load the dashboard.';
			console.error('[dashboard-route] loadDashboard failed', { error });
		} finally {
			if (runId === loadRunId) isLoading = false;
		}
	}

	function mergeRecentSummaries(
		transcriptions: TranscriptionSummary[],
		collations: CollationListItem[]
	): RecentSummary[] {
		return [
			...transcriptions.map(summary => ({
				type: 'Transcription' as const,
				id: summary.id,
				updatedAt: summary.updated_at,
				summary,
			})),
			...collations.map(summary => ({
				type: 'Collation' as const,
				id: summary.id,
				updatedAt: summary.updatedAt,
				summary,
			})),
		]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 5);
	}

	async function enrichRecentDocuments(rows: RecentSummary[]): Promise<DashboardDocument[]> {
		const documents = await Promise.all(
			rows.map(async row => {
				if (row.type === 'Transcription') {
					const status = await getProjectTranscriptionStatusForOwnedTranscription(row.id);
					if (!status) return null;
					return {
						id: row.id,
						type: row.type,
						title: row.summary.title,
						projectName: status.projectName?.trim() || 'Project unavailable',
						commitState: status.commitState,
						updatedAt: row.updatedAt,
						href: `/transcription/${row.id}`,
					} satisfies DashboardDocument;
				}

				const status = await getCollationVersionStatus(row.id);
				return {
					id: row.id,
					type: row.type,
					title: row.summary.title,
					projectName: row.summary.projectName,
					commitState: status.commitState,
					updatedAt: row.updatedAt,
					href: `/collation/${row.id}`,
				} satisfies DashboardDocument;
			})
		);
		return documents.filter((document): document is DashboardDocument => document !== null);
	}

	async function buildAttentionItems(
		projectRows: ProjectOption[],
		targets: SyncTargetRecord[],
		persistence: StoragePersistenceReport,
		estimate: StorageEstimateReport
	): Promise<DashboardAttentionItem[]> {
		if (projectRows.length === 0) return [];
		const items: DashboardAttentionItem[] = [];
		const targetsByProject = new Map<string, SyncTargetRecord>();
		for (const target of targets) {
			const current = targetsByProject.get(target.projectId);
			if (!current || (!current.enabled && target.enabled))
				targetsByProject.set(target.projectId, target);
		}

		await Promise.all(
			projectRows.map(async project => {
				const target = targetsByProject.get(project.id);
				if (!target) return;
				try {
					const summary = await deriveProjectBackupSummary({
						projectId: project.id,
						connectionId: target.targetId,
						cloudFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
						cloudFolderPath: '',
					});
					const problem = summarizeBackupProblem(project, summary);
					if (problem) items.push(problem);
				} catch (cause) {
					console.warn('[dashboard-route] project backup summary load failed', {
						projectId: project.id,
						error: cause instanceof Error ? cause.message : String(cause),
					});
					items.push(
						projectBackupAttention(project, 'Backup status is currently unavailable.')
					);
				}
			})
		);

		if (
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: persistence.status,
				dismissedMilestone: readDismissedDurabilityMilestone(),
				currentMilestone: `projects:${projectRows.length}`,
			})
		) {
			items.push({
				id: 'storage-durability',
				title: 'Protect local work from browser cleanup',
				description:
					'Persistent browser storage has not been granted for your project files.',
				href: '/data',
				linkLabel: 'Review storage durability',
			});
		}

		if (estimate.isNearQuota) {
			items.push({
				id: 'storage-quota',
				title: 'Browser storage is nearly full',
				description: 'Export a backup before adding large batches of work.',
				href: '/data',
				linkLabel: 'Review storage usage',
			});
		}

		if (projectRows.some(project => !targetsByProject.has(project.id))) {
			items.push({
				id: 'storage-setup',
				title: 'Set up a backup path',
				description:
					'Some projects are stored only in this browser. Connect folder sync or plan regular zip exports.',
				href: '/data',
				linkLabel: 'Review backup options',
			});
		}

		return items;
	}

	function summarizeBackupProblem(
		project: ProjectOption,
		summary: ProjectBackupSummary
	): DashboardAttentionItem | null {
		if (summary.remoteManifestState === 'remote-update-available')
			return projectBackupAttention(project, 'The backup contains newer project changes.');
		if (summary.remoteManifestState === 'diverged')
			return projectBackupAttention(
				project,
				'Local and backed-up project history have diverged.'
			);
		if (summary.remoteManifestState === 'unavailable')
			return projectBackupAttention(project, 'The backup provider is currently unavailable.');
		if (summary.blockingItems.length > 0)
			return projectBackupAttention(
				project,
				'Commit local changes before this project can be backed up.'
			);
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0)
			return projectBackupAttention(
				project,
				'Committed project changes are waiting to be backed up.'
			);
		return null;
	}

	function projectBackupAttention(
		project: ProjectOption,
		description: string
	): DashboardAttentionItem {
		return {
			id: `project-backup:${project.id}`,
			title: `${project.name} backup needs attention`,
			description,
			href: `/projects/${project.id}/backup`,
			linkLabel: 'Open project backup',
		};
	}

	function readDismissedDurabilityMilestone(): string | null {
		try {
			return localStorage.getItem('apatosaurus:durability-warning-dismissed-milestone');
		} catch {
			return null;
		}
	}

	onMount(() => {
		void loadDashboard();
		return subscribeLocalDbInvalidations(event => {
			if (
				['projects', 'transcriptions', 'collations', 'sync-targets', 'all'].includes(
					event.domain
				)
			) {
				void loadDashboard();
			}
		});
	});
</script>

<Dashboard
	{projects}
	{lastOpenedProject}
	{recentDocuments}
	{attentionItems}
	{isLoading}
	{error}
	appVersion={version}
/>
