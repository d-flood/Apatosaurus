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
