import { readFileSync } from 'node:fs';

const [before, after] = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
const format = result =>
	result ? `${seconds(result.ms)}${result.settledMs > 0 ? ` (${seconds(result.settledMs)})` : ''}` : '—';
const worker = result => (result?.workerMs == null ? '—' : `${(result.workerMs / 1000).toFixed(2)} s`);
const writes = result => (result?.writeCount == null ? '—' : String(result.writeCount));
const find = (run, name) => run?.results.find(result => result.name === name);

console.log(
	'| Step | Before: visible (settled) | After: visible (settled) | Before: worker | After: worker | Before: writes | After: writes |\n|---|---|---|---|---|---|---|'
);
for (const name of new Set([...before.results, ...(after?.results ?? [])].map(result => result.name))) {
	const [b, a] = [find(before, name), find(after, name)];
	console.log(
		`| ${name.trim()} | ${format(b)} | ${format(a)} | ${worker(b)} | ${worker(a)} | ${writes(b)} | ${writes(a)} |`
	);
}

const mb = (run, key) => {
	const bytes = run?.storage?.end?.[key];
	return bytes == null ? '—' : `${(bytes / 1e6).toFixed(1)} MB`;
};
console.log('\n| Storage at end | Before | After |\n|---|---|---|');
for (const [label, key] of [
	['Total', 'totalBytes'],
	['SQLite index', 'sqliteBytes'],
	['Project files', 'projectBytes'],
])
	console.log(`| ${label} | ${mb(before, key)} | ${mb(after, key)} |`);

const ms = value => (value == null ? '—' : `${value} ms`);
console.log(
	'\n| Typing, witness 2006 | Before: p50 | After: p50 | Before: p95 | After: p95 |\n|---|---|---|---|---|'
);
for (const position of ['first', 'middle', 'last']) {
	const [b, a] = [before, after].map(run =>
		run?.typing?.find(entry => entry.position === position)
	);
	console.log(`| ${position} | ${ms(b?.p50)} | ${ms(a?.p50)} | ${ms(b?.p95)} | ${ms(a?.p95)} |`);
}

console.log('\n| Type–pause–type | Field | Before | After |\n|---|---|---|---|');
const cycles = Math.max(before.typePauseType?.length ?? 0, after?.typePauseType?.length ?? 0);
for (let index = 0; index < cycles; index++)
	for (const field of [
		'longestTaskMs',
		'totalBlockingMs',
		'saveWorkerMs',
		'saveToSavedMs',
		'requestsAfterSave',
	]) {
		const [b, a] = [before, after].map(run => {
			const value = run?.typePauseType?.[index]?.[field];
			return Array.isArray(value) ? value.join(', ') || '—' : ms(value);
		});
		console.log(`| ${index + 1} | ${field} | ${b} | ${a} |`);
	}

const BASE_FIELDS = new Set(['name', 'ms', 'settledMs', 'workerMs', 'writeCount', 'writes']);
const extra = value =>
	value == null
		? '—'
		: typeof value === 'object'
			? Object.entries(value)
					.map(([k, v]) => `${k} ${v}`)
					.join(', ')
			: String(value);
console.log('\n| Step | Field | Before | After |\n|---|---|---|---|');
for (const name of new Set(
	[...before.results, ...(after?.results ?? [])].map(result => result.name)
)) {
	const [b, a] = [find(before, name), find(after, name)];
	for (const field of new Set(
		[...Object.keys(b ?? {}), ...Object.keys(a ?? {})].filter(key => !BASE_FIELDS.has(key))
	))
		console.log(`| ${name.trim()} | ${field} | ${extra(b?.[field])} | ${extra(a?.[field])} |`);
}

const longest = run =>
	[...(run?.queue ?? [])]
		.sort((x, y) => y.endedAt - y.startedAt - (x.endedAt - x.startedAt))
		.slice(0, 10);
for (const [label, run] of [
	['Before', before],
	['After', after],
]) {
	if (!run?.queue) continue;
	console.log(
		`\n| ${label}: longest DB queue sections | Step | Held | Waited |\n|---|---|---|---|`
	);
	for (const entry of longest(run))
		console.log(
			`| ${entry.label}${entry.priority ? ` (${entry.priority})` : ''} | ${entry.phase} | ${Math.round(entry.endedAt - entry.startedAt)} ms | ${Math.round(entry.startedAt - entry.enqueuedAt)} ms |`
		);
}
