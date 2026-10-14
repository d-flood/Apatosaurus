export async function mapConcurrently<T, R>(
	items: readonly T[],
	map: (item: T) => Promise<R>,
	limit = 4
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const run = async () => {
		while (next < items.length) {
			const index = next++;
			try {
				results[index] = await map(items[index]!);
			} catch (error) {
				next = items.length;
				throw error;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
	return results;
}
