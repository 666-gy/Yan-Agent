"""Render original bell sounds with inharmonic metal resonances; no network assets."""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 44100
OUT = Path(__file__).resolve().parents[1] / "renderer/assets/sounds"
OUT.mkdir(parents=True, exist_ok=True)

def render(name, strikes):
    rng = random.Random(24)
    frames = []
    duration = max(start for start, _, _ in strikes) + 2.5
    modes = [(1, 1, 1.0), (2.01, .55, .75), (2.756, .32, .5),
             (4.07, .18, .35), (5.43, .1, .22), (8.21, .045, .12)]
    for sample in range(int(duration * RATE)):
        t = sample / RATE
        value = 0
        for start, frequency, gain in strikes:
            age = t - start
            if age < 0:
                continue
            attack = 1 - math.exp(-age / .0015)
            resonance = sum(amplitude * math.exp(-age / decay)
                            * math.sin(2 * math.pi * frequency * ratio * age)
                            for ratio, amplitude, decay in modes)
            # A paired close mode creates the natural beating of a small metal bell.
            resonance += .16 * math.exp(-age / .8) * math.sin(2 * math.pi * frequency * 1.006 * age)
            resonance += .09 * rng.uniform(-1, 1) * math.exp(-age / .006)
            value += gain * attack * resonance
        fade = min(1, (duration - t) / .15)
        frames.append(value * fade)
    peak = max(abs(v) for v in frames)
    with wave.open(str(OUT / name), "wb") as audio:
        audio.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        audio.writeframes(b"".join(struct.pack("<h", round(v / peak * 24500)) for v in frames))

render("bell.wav", [(0, 1174.66, 1)])
render("double-bell.wav", [(0, 987.77, .9), (.26, 1318.51, 1)])
