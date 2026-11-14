import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const take = process.argv[2];
const dir = new URL(`./takes/${take}/`, import.meta.url).pathname;
const pub = new URL('./video/public/', import.meta.url).pathname;
const ffmpeg = new URL('./bin/ffmpeg', import.meta.url).pathname;
const appStatic = new URL('../../app/static/', import.meta.url).pathname;
mkdirSync(pub, { recursive: true });
for (const [from, to] of [
	['icons/icon-512x512.png', 'logo.png'],
	['fonts/Lora/fonts/Lora-Regular.woff2', 'Lora-Regular.woff2'],
	['fonts/Lora/fonts/Lora-SemiBold.woff2', 'Lora-SemiBold.woff2'],
	['fonts/GentiumAlt/GenAR101.woff', 'GenAR101.woff'],
])
	copyFileSync(appStatic + from, pub + to);

const { frames, events, marks } = JSON.parse(readFileSync(`${dir}timeline.json`, 'utf8'));
const t0 = frames[0].t;
const tailEnd = Math.max(
	frames.at(-1).t + 1000,
	(marks.find(m => m.name === 'end')?.t ?? 0) + 2000
);
const lines = ['ffconcat version 1.0'];
for (let i = 0; i < frames.length; i++) {
	const next = i + 1 < frames.length ? frames[i + 1].t : tailEnd;
	lines.push(`file 'frames/${String(frames[i].i).padStart(5, '0')}.jpg'`);
	lines.push(`duration ${((next - frames[i].t) / 1000).toFixed(4)}`);
}
lines.push(`file 'frames/${String(frames.at(-1).i).padStart(5, '0')}.jpg'`);
writeFileSync(`${dir}frames.ffconcat`, lines.join('\n') + '\n');

execFileSync(
	ffmpeg,
	[
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		`${dir}frames.ffconcat`,
		'-vf',
		'fps=30,format=yuv420p',
		'-c:v',
		'libx264',
		'-crf',
		'15',
		'-g',
		'15',
		'-movflags',
		'+faststart',
		`${pub}screen.mp4`,
	],
	{ stdio: 'inherit' }
);

const sec = t => +((t - t0) / 1000).toFixed(3);
const timeline = {
	videoStart: 0,
	duration: sec(tailEnd),
	marks: Object.fromEntries(marks.map(m => [m.name, sec(m.t)])),
	events: events
		.filter(e => e.t >= t0)
		.map(e => ({ t: sec(e.t), type: e.type, x: Math.round(e.x), y: Math.round(e.y) })),
};
writeFileSync(`${pub}timeline.json`, JSON.stringify(timeline));
console.log(
	'screen.mp4 + timeline.json',
	timeline.duration,
	's,',
	timeline.events.length,
	'events'
);
console.log(
	Object.entries(timeline.marks)
		.map(([k, v]) => `${k}=${v}`)
		.join('  ')
);
