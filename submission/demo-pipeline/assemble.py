"""Cut, fit and join the recorded scenes to their narration → Albedo-Watch-Demo.mp4.

* marks.json (from record.py) says where each scene really starts and where
  Gemini was thinking (send → done); that waiting time is cut out.
* Some scenes open on a Google Flow (Veo 3.1) clip from the landing page.
* Each scene is speed-fitted to its narration within sane limits, then faded.
"""
import json, pathlib, subprocess

D = pathlib.Path(__file__).parent
MEDIA = D.parents[1] / "frontend" / "public" / "media"
SCENES = [f"s{i}" for i in range(1, 12)]
BROLL = {"s1": (MEDIA / "city.mp4", 4.5), "s5": (D / "broll" / "satellite.mp4", 3.5), "s7": (MEDIA / "citizen.mp4", 4.0),
         "s8": (MEDIA / "fields.mp4", 3.0), "s9": (D / "broll" / "officer.mp4", 3.5)}
MARKS = json.loads((D / "marks.json").read_text())
TEMPO = 1.2          # Gemini TTS narrates slowly; 1.2x ≈ 138 wpm, pitch preserved
PAD = 0.4


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                                capture_output=True, text=True).stdout.strip())


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def windows(sid, vd):
    m = MARKS.get(sid, {})
    a = max(0.0, m.get("start", 0) - 0.3)
    end = min(vd, m.get("end", vd))
    if "send" in m and "done" in m and m["done"] - m["send"] > 6:
        return [(a, m["send"] + 2.5), (m["done"] - 0.6, end)]
    return [(a, end)]


parts = []
for s in SCENES:
    src, wav = D / f"{s}.webm", D / f"{s}.wav"
    broll = BROLL.get(s)
    bl = broll[1] if broll else 0.0
    delay = round(bl * 0.35, 2)              # let the opening shot breathe before the voice starts
    target = dur(wav) / TEMPO + PAD + delay
    vd = dur(src)
    wins = windows(s, vd)
    app_len = sum(b - a for a, b in wins)
    need = target - bl
    f = need / app_len                      # >1 slows down, <1 speeds up
    f = min(1.15, max(0.45, f))             # never absurdly fast or slow; freeze/trim covers the rest
    inputs = ["-i", str(src)]
    fc = []
    for k, (a, b) in enumerate(wins):
        fc.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[w{k}]")
    fc.append("".join(f"[w{k}]" for k in range(len(wins))) + f"concat=n={len(wins)}:v=1:a=0[raw]")
    fc.append(f"[raw]setpts={f:.5f}*PTS,fps=30,scale=1600:900:flags=lanczos,setsar=1,"
              f"tpad=stop_mode=clone:stop_duration=6,trim=duration={need:.3f},"
              f"fade=t=in:st=0:d=0.4,fade=t=out:st={need - 0.45:.3f}:d=0.45[app]")
    if broll:
        inputs += ["-i", str(broll[0])]
        fc.append(f"[1:v]fps=30,scale=1600:900:flags=lanczos,setsar=1,trim=duration={bl:.3f},setpts=PTS-STARTPTS,"
                  f"fade=t=in:st=0:d=0.5,fade=t=out:st={bl - 0.4:.3f}:d=0.4[br]")
        fc.append("[br][app]concat=n=2:v=1:a=0[v]")
    else:
        fc.append("[app]null[v]")
    ai = len(inputs) // 2
    inputs += ["-i", str(wav)]
    fc.append(f"[{ai}:a]atempo={TEMPO},adelay={int(delay * 1000)}|{int(delay * 1000)},apad=pad_dur=1,atrim=duration={target:.3f},"
              f"afade=t=in:d=0.2,afade=t=out:st={target - 0.3:.3f}:d=0.3[a]")
    out = D / f"{s}_fit.mp4"
    run([*inputs, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", "-t", f"{target:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-ar", "48000", str(out)])
    print(f"{s}: rec {vd:.1f}s → kept {app_len:.1f}s ×{1 / f:.2f} speed + b-roll {bl:.1f}s = {target:.1f}s")
    parts.append(out)

lst = D / "concat.txt"
lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
final = D.parent / "Albedo-Watch-Demo.mp4"
run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(final)])
print("final", round(dur(final), 1), "s", round(final.stat().st_size / 1e6, 1), "MB →", final)
