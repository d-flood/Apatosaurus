/**
 * Coalesces rapid edits into sequential saves: at most one save runs at a time, and `flush`
 * keeps saving the latest value until nothing is pending.
 */
export function createDebouncedSave<T>(options: {
	read: () => T | null;
	save: (value: T) => Promise<boolean>;
	onSettled?: () => void;
	delayMs?: number;
}) {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let pendingSave = false;
	let saveInFlight: Promise<boolean> | null = null;

	async function saveNext(value: T): Promise<boolean> {
		saveInFlight = options.save(value);
		try {
			return await saveInFlight;
		} finally {
			saveInFlight = null;
		}
	}

	async function drain(): Promise<boolean> {
		let saved = true;
		if (saveInFlight) saved = await saveInFlight;
		while (pendingSave) {
			pendingSave = false;
			const value = options.read();
			if (value === null) {
				saved = false;
				break;
			}
			saved = await saveNext(value);
			if (!saved) {
				pendingSave = true;
				break;
			}
			if (saveInFlight) saved = await saveInFlight;
		}
		const settled = saved && !pendingSave && !saveInFlight;
		if (settled) options.onSettled?.();
		return settled;
	}

	return {
		schedule() {
			pendingSave = true;
			if (timeoutId !== null) clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				timeoutId = null;
				void drain();
			}, options.delayMs ?? 1000);
		},
		flush(): Promise<boolean> {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			return drain();
		},
	};
}
