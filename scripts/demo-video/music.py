import sys
import wave

import numpy as np

SR = 48000
T = float(sys.argv[1])
TC = float(sys.argv[2])
OUT = sys.argv[3]

BPM = 84
BEAT = 60 / BPM
BAR = 4 * BEAT

def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)

CHORDS = {
    'D': (38, [62, 66, 69]),
    'Bm': (35, [59, 62, 66]),
    'G': (43, [59, 62, 67]),
    'A': (45, [61, 64, 69]),
    'Em': (40, [59, 64, 67]),
}
LOOP = ['D', 'Bm', 'G', 'A', 'D', 'Bm', 'Em', 'A']

n = int(T * SR) + SR
L = np.zeros(n)
R = np.zeros(n)

def add(start: float, sig: np.ndarray, pan: float = 0.0):
    i = int(start * SR)
    if i >= n:
        return
    j = min(n, i + len(sig))
    if i < 0:
        sig = sig[-i:]
        j = min(n, len(sig))
        i = 0
    seg = sig[: j - i]
    L[i:j] += seg * np.sqrt(0.5 * (1 - pan))
    R[i:j] += seg * np.sqrt(0.5 * (1 + pan))

def bell(freq: float, dur: float, amp: float) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 3.2) * np.minimum(1, t / 0.006)
    tone = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 4) + 0.12 * np.sin(2 * np.pi * 3.01 * freq * t) * np.exp(-t * 7)
    return amp * env * tone

def pad(freqs: list[float], dur: float, amp: float) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(1, t / 0.9) * np.minimum(1, np.maximum(0, (dur - t) / 1.2))
    sig = sum(np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * f * 1.003 * t + 1.1) for f in freqs)
    return amp * env * sig / len(freqs)

def bass(freq: float, dur: float, amp: float) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 1.1) * np.minimum(1, t / 0.02)
    return amp * env * (np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t))

bars_before = int(np.ceil(TC / BAR))
cadence = ['G', 'A']
for k in range(-bars_before, 0):
    start = TC + k * BAR
    if start + BAR < 0:
        continue
    idx = k + bars_before
    name = cadence[k + 2] if k >= -2 else LOOP[idx % len(LOOP)]
    root, tones = CHORDS[name]
    add(start, pad([midi(x) for x in tones], BAR + 1.2, 0.10), 0.0)
    add(start, bass(midi(root), BAR, 0.16), -0.1)
    pattern = [0, 1, 2, 1, 2, 0, 1, 2]
    for e in range(8):
        note = tones[pattern[e]] + 12
        if e == 0 and idx % 2 == 1:
            note += 0
        add(start + e * BEAT / 2, bell(midi(note), 1.6, 0.075 if e % 2 == 0 else 0.055), 0.35 if e % 2 else -0.25)
    if idx % 4 == 3 and k < -2:
        add(start + 3 * BEAT, bell(midi(tones[2] + 24), 2.0, 0.04), 0.5)

root, tones = CHORDS['D']
tail = T - TC + 1
add(TC, pad([midi(x) for x in tones + [74]], tail, 0.13))
add(TC, bass(midi(root), tail, 0.2), -0.1)
for i, note in enumerate([62, 66, 69, 74, 78]):
    add(TC + i * 0.07, bell(midi(note + 12), 4.0, 0.07), -0.3 + 0.15 * i)

mix = np.stack([L, R], axis=1)[: int(T * SR)]
mix /= max(1e-9, np.abs(mix).max()) / 0.5
data = (mix * 32767).astype('<i2')
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print(f'wrote {OUT}: {T:.2f}s, cadence at {TC:.2f}s')
