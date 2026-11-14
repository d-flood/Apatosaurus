import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Img,
	interpolate,
	OffthreadVideo,
	Sequence,
	Series,
	staticFile,
	useCurrentFrame,
	Easing,
} from 'remotion';
import {
	FPS,
	W,
	H,
	INTRO,
	OUTRO,
	clips,
	cameraKeys,
	captions,
	events,
	totalFrames,
	type Focus,
	type CaptionPos,
} from './edit';

const C = {
	cream: '#fdf6ee',
	paper: '#fffaf4',
	primary: 'oklch(55% 0.195 38.402)',
	ink: 'oklch(40% 0.123 38.172)',
	teal: 'oklch(52% 0.095 210)',
	muted: 'oklch(55% 0.06 45)',
};
const SANS = 'Roboto, "Segoe UI", system-ui, sans-serif';
const SERIF = '"Lora Demo", Georgia, serif';
const GREEK = '"Gentium Demo", "Lora Demo", serif';

const FontFaces: React.FC = () => (
	<style>{`
@font-face { font-family: 'Lora Demo'; src: url('${staticFile('Lora-Regular.woff2')}') format('woff2'); font-weight: 400; }
@font-face { font-family: 'Lora Demo'; src: url('${staticFile('Lora-SemiBold.woff2')}') format('woff2'); font-weight: 600; }
@font-face { font-family: 'Gentium Demo'; src: url('${staticFile('GenAR101.woff')}') format('woff'); }
`}</style>
);

const moves = events.filter(e => e.type === 'move' || e.type === 'down' || e.type === 'up');
const downs = events.filter(e => e.type === 'down');

function cursorAt(t: number): { x: number; y: number } {
	if (moves.length === 0) return { x: W / 2, y: H / 2 };
	let lo = 0;
	let hi = moves.length - 1;
	if (t <= moves[0].t) return moves[0];
	if (t >= moves[hi].t) return moves[hi];
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (moves[mid].t <= t) lo = mid;
		else hi = mid;
	}
	const a = moves[lo];
	const b = moves[hi];
	const p = b.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
	return b.t - a.t > 0.25 ? a : { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

function smoothedCursor(t: number): [number, number] {
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (let s = t - 1.4; s <= t + 0.5; s += 0.05) {
		const p = cursorAt(s);
		sx += p.x;
		sy += p.y;
		n += 1;
	}
	return [sx / n, sy / n];
}

const easeIO = Easing.bezier(0.65, 0, 0.35, 1);

function resolveFocus(focus: Focus, t: number): [number, number] {
	return focus === 'cursor' ? smoothedCursor(t) : focus;
}

function cameraAt(t: number): { s: number; fx: number; fy: number } {
	let idx = -1;
	for (let i = 0; i < cameraKeys.length; i++) if (cameraKeys[i].t <= t) idx = i;
	let s: number;
	let f: [number, number];
	if (idx < 0) {
		s = cameraKeys[0].scale;
		f = resolveFocus(cameraKeys[0].focus, t);
	} else {
		const k = cameraKeys[idx];
		const prev = cameraKeys[Math.max(0, idx - 1)];
		const p = easeIO(Math.min(1, Math.max(0, (t - k.t) / k.dur)));
		const pf = resolveFocus(prev.focus, t);
		const kf = resolveFocus(k.focus, t);
		s = Math.exp(Math.log(prev.scale) + (Math.log(k.scale) - Math.log(prev.scale)) * p);
		f = [pf[0] + (kf[0] - pf[0]) * p, pf[1] + (kf[1] - pf[1]) * p];
	}
	const hw = W / (2 * s);
	const hh = H / (2 * s);
	return {
		s,
		fx: Math.min(W - hw, Math.max(hw, f[0])),
		fy: Math.min(H - hh, Math.max(hh, f[1])),
	};
}

const Pointer: React.FC<{ x: number; y: number; k: number }> = ({ x, y, k }) => (
	<svg
		width={30}
		height={30}
		viewBox="0 0 24 24"
		style={{
			position: 'absolute',
			left: x,
			top: y,
			transform: `scale(${k})`,
			transformOrigin: '0 0',
			filter: 'drop-shadow(0 2px 3px rgba(60,30,10,.35))',
		}}
	>
		<path
			d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.4 Z"
			fill="white"
			stroke="#2b160b"
			strokeWidth={1.4}
			strokeLinejoin="round"
		/>
	</svg>
);

const ClipView: React.FC<{ from: number; speed: number }> = ({ from, speed }) => {
	const frame = useCurrentFrame();
	const t = from + (frame / FPS) * speed;
	const { s, fx, fy } = cameraAt(t);
	const cur = cursorAt(t);
	const k = 1 / Math.sqrt(s);
	const ripples = downs.filter(d => t >= d.t && t - d.t < 0.5);
	return (
		<AbsoluteFill style={{ backgroundColor: C.paper, overflow: 'hidden' }}>
			<div
				style={{
					position: 'absolute',
					width: W,
					height: H,
					transformOrigin: '0 0',
					transform: `translate(${W / 2 - fx * s}px, ${H / 2 - fy * s}px) scale(${s})`,
				}}
			>
				<OffthreadVideo
					src={staticFile('screen.mp4')}
					trimBefore={Math.round(from * FPS)}
					playbackRate={speed}
					muted
					style={{ width: W, height: H }}
				/>
				{ripples.map(d => {
					const p = (t - d.t) / 0.5;
					const r = (8 + 30 * Easing.out(Easing.cubic)(p)) * k;
					return (
						<div
							key={d.t}
							style={{
								position: 'absolute',
								left: d.x - r,
								top: d.y - r,
								width: r * 2,
								height: r * 2,
								borderRadius: '50%',
								border: `${3 * k}px solid ${C.primary}`,
								opacity: 1 - p,
								background: 'oklch(55% 0.195 38.402 / 0.12)',
							}}
						/>
					);
				})}
				<Pointer x={cur.x} y={cur.y} k={k} />
			</div>
			<Captions t={t} />
		</AbsoluteFill>
	);
};

const POS: Record<CaptionPos, React.CSSProperties> = {
	bl: { left: 48, bottom: 48 },
	br: { right: 48, bottom: 48 },
	tr: { right: 48, top: 48 },
};

const Captions: React.FC<{ t: number }> = ({ t }) => {
	const c = captions.find(c => t >= c.from && t < c.to);
	if (!c) return null;
	const inP = Math.min(1, (t - c.from) / 0.45);
	const outP = Math.min(1, Math.max(0, (c.to - t) / 0.3));
	const first = captions.filter(x => x.step === c.step)[0] === c;
	const o = Math.min(easeIO(inP), outP);
	return (
		<div
			style={{
				position: 'absolute',
				...POS[c.pos],
				maxWidth: 720,
				display: 'flex',
				gap: 18,
				alignItems: 'flex-start',
				padding: '20px 26px 22px 20px',
				borderRadius: 22,
				background: 'rgba(255, 250, 244, 0.93)',
				border: '1px solid rgba(160, 80, 40, 0.18)',
				boxShadow: '0 18px 50px rgba(90, 40, 10, 0.22)',
				opacity: o,
				transform: `translateY(${(1 - easeIO(inP)) * (first ? 18 : 6)}px)`,
			}}
		>
			<div
				style={{
					flex: '0 0 auto',
					width: 46,
					height: 46,
					borderRadius: 23,
					background: C.primary,
					color: 'white',
					fontFamily: SANS,
					fontWeight: 700,
					fontSize: 24,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				{c.step}
			</div>
			<div>
				<div
					style={{
						fontFamily: SERIF,
						fontWeight: 600,
						fontSize: 31,
						color: C.ink,
						lineHeight: 1.15,
					}}
				>
					{c.title}
				</div>
				<div
					style={{
						fontFamily: `${SANS}`,
						fontSize: 22,
						color: C.ink,
						opacity: 0.85,
						marginTop: 7,
						lineHeight: 1.38,
					}}
				>
					{c.line.split(/([Ͱ-Ͽἀ-῿’]+(?:\s[Ͱ-Ͽἀ-῿]+)*)/).map((part, i) =>
						/[Ͱ-Ͽἀ-῿]/.test(part) ? (
							<span key={i} style={{ fontFamily: GREEK, fontSize: 25 }}>
								{part}
							</span>
						) : (
							<React.Fragment key={i}>{part}</React.Fragment>
						)
					)}
				</div>
			</div>
		</div>
	);
};

const STEPS = ['Setup', 'Alignment', 'Readings', 'Local stemma', 'Review'];

const Intro: React.FC = () => {
	const f = useCurrentFrame();
	const t = f / FPS;
	const a = (d: number) => easeIO(Math.min(1, Math.max(0, (t - d) / 0.7)));
	const out = interpolate(t, [INTRO - 0.45, INTRO], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return (
		<AbsoluteFill
			style={{
				background: `radial-gradient(ellipse at 30% 20%, #fffaf3 0%, ${C.cream} 55%, #f7e7d6 100%)`,
				opacity: out,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<div
				style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 18,
						opacity: a(0),
						transform: `translateY(${(1 - a(0)) * 16}px)`,
					}}
				>
					<Img src={staticFile('logo.png')} style={{ width: 84, height: 84 }} />
					<span
						style={{
							fontFamily: SERIF,
							fontSize: 40,
							color: C.ink,
							letterSpacing: 0.5,
						}}
					>
						Apatosaurus
					</span>
				</div>
				<div
					style={{
						fontFamily: SERIF,
						fontWeight: 600,
						fontSize: 92,
						color: C.ink,
						opacity: a(0.25),
						transform: `translateY(${(1 - a(0.25)) * 20}px)`,
					}}
				>
					The collation flow
				</div>
				<div style={{ fontFamily: SANS, fontSize: 30, color: C.muted, opacity: a(0.55) }}>
					Romans 8:28 · 11 IGNTP transcriptions
				</div>
				<div style={{ display: 'flex', gap: 14, marginTop: 18 }}>
					{STEPS.map((s, i) => (
						<div
							key={s}
							style={{
								fontFamily: SANS,
								fontSize: 24,
								fontWeight: 600,
								padding: '10px 20px',
								borderRadius: 999,
								color: i === 0 ? 'white' : C.ink,
								background: i === 0 ? C.primary : 'rgba(255,255,255,0.75)',
								border: '1px solid rgba(160, 80, 40, 0.22)',
								opacity: a(0.8 + i * 0.12),
								transform: `translateY(${(1 - a(0.8 + i * 0.12)) * 12}px)`,
							}}
						>
							{i + 1} · {s}
						</div>
					))}
				</div>
			</div>
		</AbsoluteFill>
	);
};

const Outro: React.FC = () => {
	const f = useCurrentFrame();
	const t = f / FPS;
	const a = (d: number) => easeIO(Math.min(1, Math.max(0, (t - d) / 0.7)));
	return (
		<AbsoluteFill
			style={{
				background: `radial-gradient(ellipse at 70% 80%, #fffaf3 0%, ${C.cream} 55%, #f7e7d6 100%)`,
				alignItems: 'center',
				justifyContent: 'center',
				opacity: a(0),
			}}
		>
			<div
				style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}
			>
				<Img
					src={staticFile('logo.png')}
					style={{ width: 96, height: 96, opacity: a(0.1) }}
				/>
				<div
					style={{
						fontFamily: SERIF,
						fontWeight: 600,
						fontSize: 72,
						color: C.ink,
						opacity: a(0.2),
					}}
				>
					Apatosaurus
				</div>
				<div style={{ display: 'flex', gap: 12, opacity: a(0.45) }}>
					{STEPS.map((s, i) => (
						<React.Fragment key={s}>
							<span
								style={{
									fontFamily: SANS,
									fontSize: 26,
									color: C.ink,
									fontWeight: 600,
								}}
							>
								{s}
							</span>
							{i < STEPS.length - 1 && (
								<span style={{ fontFamily: SANS, fontSize: 26, color: C.primary }}>
									→
								</span>
							)}
						</React.Fragment>
					))}
				</div>
				<div
					style={{
						marginTop: 40,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 10,
						fontFamily: SANS,
						fontSize: 21,
						color: C.muted,
						opacity: a(0.9),
					}}
				>
					<div>
						Transcriptions: International Greek New Testament Project (IGNTP), CC BY 4.0
					</div>
					<div>Music: original, generated for this video</div>
					<div style={{ color: C.teal, fontWeight: 600, marginTop: 8 }}>
						apatosaurus.io
					</div>
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const Demo: React.FC = () => (
	<AbsoluteFill style={{ backgroundColor: C.cream }}>
		<FontFaces />
		<Series>
			<Series.Sequence durationInFrames={Math.round(INTRO * FPS)}>
				<Intro />
			</Series.Sequence>
			{clips.map((c, i) => (
				<Series.Sequence key={i} durationInFrames={c.frames}>
					<ClipView from={c.from} speed={c.speed} />
				</Series.Sequence>
			))}
			<Series.Sequence durationInFrames={Math.round(OUTRO * FPS)}>
				<Outro />
			</Series.Sequence>
		</Series>
		<Sequence from={0} durationInFrames={totalFrames}>
			<Audio src={staticFile('music.wav')} />
		</Sequence>
	</AbsoluteFill>
);
