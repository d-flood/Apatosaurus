export function variationUnitId(firstColumnId: string, lastColumnId = firstColumnId): string {
	return firstColumnId === lastColumnId
		? `unit:${firstColumnId}`
		: `unit:${firstColumnId}..${lastColumnId}`;
}
