"""Fit each recorded scene to its narration, add fades, concatenate → MP4."""
import pathlib, subprocess

D = pathlib.Path(__file__).parent
SCENES = [f"s{i}" for i in range(1, 10)]
# (keep_start, keep_end) windows to cut dead waiting time, in source seconds
CUTS = {"s7": [(0, 5.5), (46.5, None)]}


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                                capture_output=True, text=True).stdout.strip())


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


parts = []
for s in SCENES:
    src, wav = D / f"{s}.webm", D / f"{s}.wav"
    a = dur(wav)
    target = a + 0.5
    work = src
    if s in CUTS:
        vd = dur(src)
        segs = "+".join(f"between(t,{st},{en if en is not None else vd})" for st, en in CUTS[s])
        work = D / f"{s}_cut.mp4"
        run(["-i", str(src), "-vf", f"select='{segs}',setpts=N/FRAME_RATE/TB", "-an", "-r", "25", str(work)])
    vd = dur(work)
    f = target / vd
    out = D / f"{s}_fit.mp4"
    vf = (f"setpts={f:.5f}*PTS,fps=30,scale=1600:900:flags=lanczos,"
          f"tpad=stop_mode=clone:stop_duration=2,trim=duration={target:.3f},"
          f"fade=t=in:st=0:d=0.45,fade=t=out:st={target - 0.45:.3f}:d=0.45")
    run(["-i", str(work), "-i", str(wav), "-filter_complex",
         f"[0:v]{vf}[v];[1:a]apad=pad_dur=0.5,atrim=duration={target:.3f},afade=t=in:d=0.2[a]",
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-ar", "48000", str(out)])
    print(s, f"video {vd:.1f}s → {target:.1f}s (x{1 / f:.2f} speed)")
    parts.append(out)

lst = D / "concat.txt"
lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
final = D / "Albedo-Watch-Demo.mp4"
run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(final)])
print("final", round(dur(final), 1), "s", round(final.stat().st_size / 1e6, 1), "MB")
