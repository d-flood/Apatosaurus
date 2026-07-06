type LockManagerLike = {
	request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
};

type NavigatorWithLocks = Navigator & { locks?: LockManagerLike };

export async function withProjectWriteLock<T>(
	projectId: string,
	operation: () => Promise<T>
): Promise<T> {
	const locks = (globalThis.navigator as NavigatorWithLocks | undefined)?.locks;
	if (!locks?.request) return operation();
	return locks.request(projectWriteLockName(projectId), operation);
}

export function projectWriteLockName(projectId: string): string {
	return `apatosaurus:project:${projectId}`;
}
