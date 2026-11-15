class IndexRebuildProgress {
	done = $state(0);
	total = $state(0);
	phase = $state<'rebuild' | 'conversion'>('rebuild');
}

export const indexRebuildProgress = new IndexRebuildProgress();
