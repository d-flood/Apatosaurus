<script lang="ts">
	import WarningOctagon from 'phosphor-svelte/lib/WarningOctagon';
	import { migrationGate } from '$lib/client/migration-gate.svelte';
	import { requestHardLocalDbReset, resolvePendingMigration } from '$lib/client/djazzkit-runtime';

	let dialogRef = $state<HTMLDialogElement | null>(null);
	let actionPending = $state(false);

	$effect(() => {
		const dialog = dialogRef;
		if (!dialog) return;
		if (migrationGate.isOpen && !dialog.open) {
			dialog.showModal();
			return;
		}
		if (!migrationGate.isOpen && dialog.open) {
			dialog.close();
		}
	});

	function onClose(): void {
		if (!actionPending) {
			migrationGate.dismiss();
		}
	}

	async function choose(action: 'approve' | 'defer' | 'reset'): Promise<void> {
		if (action === 'defer') {
			migrationGate.dismiss();
			return;
		}
		if (action === 'reset') {
			requestHardLocalDbReset();
			return;
		}
		if (migrationGate.awaitingDecision) {
			migrationGate.resolve(action);
			return;
		}
		actionPending = true;
		try {
			await resolvePendingMigration(action);
			migrationGate.dismiss();
		} catch (error) {
			console.error('Failed to resolve pending migration action:', error);
		} finally {
			actionPending = false;
		}
	}
</script>

<dialog bind:this={dialogRef} class="modal" onclose={onClose}>
	<div class="modal-box">
		<div class="flex items-start gap-3">
			<WarningOctagon size={28} class="text-warning mt-1 shrink-0" />
			<div>
				<h3 class="font-semibold text-lg">Schema Update Approval Required</h3>
				<p class="text-sm text-base-content/80 mt-1">
					A local SQLite schema change is pending. Choose whether to run migration steps or reset your
					local database.
				</p>
			</div>
		</div>

		{#if migrationGate.info}
			<div class="mt-4 space-y-3 text-sm">
				<div class="rounded-box border border-base-300 bg-base-200/60 p-3">
					<div>
						<span class="font-medium">Current schema:</span> {migrationGate.info.currentSchemaVersion}
					</div>
					<div>
						<span class="font-medium">Target schema:</span> {migrationGate.info.targetSchemaVersion}
					</div>
				</div>

				{#if migrationGate.info.pendingMigrations.length > 0}
					<div>
						<div class="font-medium mb-2">Pending migration steps</div>
						<ul class="menu rounded-box border border-base-300 bg-base-100 p-2">
							{#each migrationGate.info.pendingMigrations as step}
								<li>
									<div class="justify-between">
										<span>{step.id}</span>
										<span class="badge badge-warning badge-sm">{step.riskLevel}</span>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}

		<div class="modal-action">
			<button class="btn btn-ghost" onclick={() => choose('defer')} disabled={actionPending}>
				Not now
			</button>
			<button class="btn btn-error" onclick={() => choose('reset')} disabled={actionPending}>
				Reset local DB
			</button>
			<button class="btn btn-primary" onclick={() => choose('approve')} disabled={actionPending}>
				Approve migration
			</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button aria-label="Close schema migration modal">close</button>
	</form>
</dialog>
