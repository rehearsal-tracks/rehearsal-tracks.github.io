#!/usr/bin/env python3
"""Generate four short, musically-distinct demo stems as WAV files.

These are placeholder stems so the player works out of the box. Replace them
with your own exported tracks (see README). Pure standard-library — no numpy.

Each stem is the same length and sample rate so they loop in perfect sync.
"""
import math
import os
import struct
import wave

SAMPLE_RATE = 44100
BARS = 2
BPM = 100
SECONDS_PER_BEAT = 60.0 / BPM
BEATS = BARS * 4
DURATION = BEATS * SECONDS_PER_BEAT  # whole number of bars -> seamless loop
N = int(SAMPLE_RATE * DURATION)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "stems", "demo")


def note(freq):
    return 2 * math.pi * freq / SAMPLE_RATE


def envelope(t_in_beat):
    """Short percussive decay envelope (0..1) given time since note onset."""
    return math.exp(-6.0 * t_in_beat)


def write_wav(name, samples):
    path = os.path.join(OUT_DIR, name + ".wav")
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = 0.89 / peak  # normalize with headroom
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            v = int(max(-1.0, min(1.0, s * scale)) * 32767)
            frames += struct.pack("<h", v)
        w.writeframes(frames)
    print("wrote", path)


def gen_drums():
    out = [0.0] * N
    for i in range(N):
        t = i / SAMPLE_RATE
        beat_pos = (t / SECONDS_PER_BEAT)
        in_beat = (beat_pos % 1.0) * SECONDS_PER_BEAT
        beat = int(beat_pos) % 4
        # kick on beats 0 and 2
        if beat in (0, 2):
            f = 110 * math.exp(-18 * in_beat) + 45
            out[i] += math.sin(note(f) * i) * envelope(in_beat) * 1.0
        # snare-ish noise on beats 1 and 3
        if beat in (1, 3):
            noise = ((i * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff * 2 - 1
            out[i] += noise * math.exp(-22 * in_beat) * 0.5
        # hats every half beat
        half = (beat_pos * 2) % 1.0 * SECONDS_PER_BEAT
        noise = ((i * 22695477 + 1) & 0x7fffffff) / 0x7fffffff * 2 - 1
        out[i] += noise * math.exp(-60 * half) * 0.18
    return out


def gen_bass():
    pattern = [55.00, 55.00, 82.41, 73.42]  # A1 A1 E2 D2 per beat
    out = [0.0] * N
    for i in range(N):
        t = i / SAMPLE_RATE
        beat_pos = t / SECONDS_PER_BEAT
        in_beat = (beat_pos % 1.0) * SECONDS_PER_BEAT
        f = pattern[int(beat_pos) % 4]
        s = math.sin(note(f) * i) + 0.3 * math.sin(note(f * 2) * i)
        out[i] = s * (0.5 + 0.5 * math.exp(-2.5 * in_beat))
    return out


def gen_chords():
    # A minor (A C E) for 1 bar, F major (F A C) for next bar
    chord_a = [220.00, 261.63, 329.63]
    chord_f = [174.61, 220.00, 261.63]
    out = [0.0] * N
    for i in range(N):
        t = i / SAMPLE_RATE
        bar = int(t / (SECONDS_PER_BEAT * 4)) % 2
        chord = chord_a if bar == 0 else chord_f
        in_bar = (t % (SECONDS_PER_BEAT * 4))
        s = sum(math.sin(note(f) * i) for f in chord) / len(chord)
        out[i] = s * (0.4 + 0.6 * math.exp(-0.8 * in_bar)) * 0.7
    return out


def gen_lead():
    # simple melody, one note per beat
    melody = [440.00, 523.25, 659.25, 587.33, 523.25, 440.00, 392.00, 440.00]
    out = [0.0] * N
    for i in range(N):
        t = i / SAMPLE_RATE
        beat_pos = t / SECONDS_PER_BEAT
        in_beat = (beat_pos % 1.0) * SECONDS_PER_BEAT
        f = melody[int(beat_pos) % len(melody)]
        vibrato = 1 + 0.006 * math.sin(2 * math.pi * 5 * t)
        s = math.sin(note(f * vibrato) * i)
        out[i] = s * math.exp(-1.8 * in_beat) * 0.8
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    write_wav("drums", gen_drums())
    write_wav("bass", gen_bass())
    write_wav("chords", gen_chords())
    write_wav("lead", gen_lead())


if __name__ == "__main__":
    main()
