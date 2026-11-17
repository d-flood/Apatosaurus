import { isCloudProviderError, type CloudProviderErrorCode } from './providers/provider';
import type { SyncOperationResult, SyncUiState } from './sync-manager';

export type OpenObjectPollerConnectionState =
	'idle' | 'polling' | 'backing-off' | 'reconnect-required';

export interface OpenObjectSyncPollerOptions {
	poll: () => Promise<SyncOperationResult>;
	baseIntervalMs?: number;
	maxIntervalMs?: number;
	/** Delays the first scheduled poll; direct polls are not delayed. */
	firstPollAfter?: () => Promise<void>;
	setTimeout?: typeof globalThis.setTimeout;
	clearTimeout?: typeof globalThis.clearTimeout;
}

export class OpenObjectSyncPoller {
	uiState: SyncUiState = 'saved locally';
	connectionState: OpenObjectPollerConnectionState = 'idle';
	nextDelayMs: number;
	lastResult: SyncOperationResult | null = null;
	private readonly poll: () => Promise<SyncOperationResult>;
	private readonly baseIntervalMs: number;
	private readonly maxIntervalMs: number;
	private readonly firstPollAfter?: () => Promise<void>;
	private readonly setTimer: typeof globalThis.setTimeout;
	private readonly clearTimer: typeof globalThis.clearTimeout;
	private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
	private stopped = true;

	constructor(options: OpenObjectSyncPollerOptions) {
		this.poll = options.poll;
		this.baseIntervalMs = options.baseIntervalMs ?? 30_000;
		this.maxIntervalMs = options.maxIntervalMs ?? 60_000;
		this.firstPollAfter = options.firstPollAfter;
		this.nextDelayMs = this.baseIntervalMs;
		this.setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
		this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		if (!this.firstPollAfter) return this.schedule(0);
		void this.firstPollAfter().then(() => {
			if (!this.timer && this.connectionState === 'idle') this.schedule(0);
		});
	}

	stop(): void {
		this.stopped = true;
		this.connectionState = 'idle';
		if (this.timer) this.clearTimer(this.timer);
		this.timer = null;
	}

	resumeAfterReconnect(): void {
		if (this.connectionState !== 'reconnect-required') return;
		this.connectionState = 'idle';
		this.stopped = false;
		this.nextDelayMs = this.baseIntervalMs;
		this.schedule(0);
	}

	focus(): Promise<SyncOperationResult | null> {
		return this.pollNow();
	}

	online(): Promise<SyncOperationResult | null> {
		return this.pollNow();
	}

	async pollNow(): Promise<SyncOperationResult | null> {
		if (this.stopped || this.connectionState === 'reconnect-required') return null;
		if (this.timer) this.clearTimer(this.timer);
		this.timer = null;
		this.connectionState = 'polling';
		try {
			const result = await this.poll();
			this.lastResult = result;
			this.uiState = result.uiState;
			if (result.providerError === 'reauthorization-required') {
				this.connectionState = 'reconnect-required';
				this.stopped = true;
				return result;
			}
			if (result.providerError && isBackoffProviderError(result.providerError)) {
				this.connectionState = 'backing-off';
				this.nextDelayMs = Math.min(this.nextDelayMs * 2, this.maxIntervalMs);
				this.schedule(this.nextDelayMs);
				return result;
			}
			this.connectionState = 'idle';
			this.nextDelayMs = this.baseIntervalMs;
			this.schedule(this.baseIntervalMs);
			return result;
		} catch (error) {
			if (isCloudProviderError(error, 'reauthorization-required')) {
				this.connectionState = 'reconnect-required';
				this.stopped = true;
				return null;
			}
			if (isCloudProviderError(error) && isBackoffProviderError(error.code)) {
				this.connectionState = 'backing-off';
				this.nextDelayMs = Math.min(this.nextDelayMs * 2, this.maxIntervalMs);
				this.schedule(this.nextDelayMs);
				return null;
			}
			throw error;
		}
	}

	private schedule(delayMs: number): void {
		if (this.stopped || this.connectionState === 'reconnect-required') return;
		if (this.timer) this.clearTimer(this.timer);
		this.timer = this.setTimer(() => {
			void this.pollNow();
		}, delayMs);
	}
}

function isBackoffProviderError(code: CloudProviderErrorCode): boolean {
	return code === 'rate-limited' || code === 'provider-unavailable' || code === 'unknown';
}
