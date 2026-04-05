import type {
	MigrationRequiredInfo,
	MigrationResolutionAction
} from '../../../../djazzkit/packages/core/src/index';

class MigrationGate {
	isOpen = $state(false);
	awaitingDecision = $state(false);
	info = $state<MigrationRequiredInfo | null>(null);
	private resolver: ((action: MigrationResolutionAction) => void) | null = null;

	present(info: MigrationRequiredInfo): void {
		this.info = info;
		this.isOpen = true;
		this.awaitingDecision = false;
		this.resolver = null;
	}

	async requestApproval(info: MigrationRequiredInfo): Promise<MigrationResolutionAction> {
		this.present(info);
		this.awaitingDecision = true;
		return new Promise<MigrationResolutionAction>(resolve => {
			this.resolver = resolve;
		});
	}

	resolve(action: MigrationResolutionAction): void {
		if (!this.resolver) return;
		const resolve = this.resolver;
		this.resolver = null;
		this.isOpen = false;
		this.awaitingDecision = false;
		resolve(action);
	}

	dismiss(): void {
		if (!this.resolver) {
			this.isOpen = false;
			return;
		}
		this.resolve('defer');
	}

	reopen(): void {
		if (!this.info) return;
		this.isOpen = true;
	}

	clearInfo(): void {
		this.info = null;
	}
}

export const migrationGate = new MigrationGate();
