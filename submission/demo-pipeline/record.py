"""Record Albedo-Watch demo scenes with Playwright on the real GPU (one video per scene).

Usage: python record.py [s1,s2,...]   — records against the live deployment.
Writes sN.webm plus marks.json (seconds from the start of each recording) so
assemble.py can cut out the time spent waiting for Gemini.
"""
import asyncio, json, pathlib, re, shutil, subprocess, sys, time
from playwright.async_api import async_playwright

BASE = "https://albedo-watch-621000818329.asia-south1.run.app"
OUT = pathlib.Path(__file__).parent
W, H = 1600, 900
# Hardware rendering: the 3D globe needs a GPU to run smoothly on video.
ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
ONBOARDED = "try { localStorage.setItem('aw-onboarded','1'); localStorage.setItem('aw-tapped','1') } catch (e) {}"
PANEL = ".mc-panel-body"
MARKS: dict[str, dict[str, float]] = {}


def dur(wav):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)], capture_output=True, text=True)
    return float(r.stdout.strip())


async def smooth_scroll(pg, to, ms, el="window"):
    js = """([to, ms, sel]) => new Promise(r => {
      const t = sel === 'window' ? null : document.querySelector(sel);
      if (sel !== 'window' && !t) return r();
      const from = t ? t.scrollTop : scrollY, t0 = performance.now();
      const step = (n) => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;
        const y = from + (to - from) * e; t ? (t.scrollTop = y) : scrollTo(0, y); k < 1 ? requestAnimationFrame(step) : r(); };
      requestAnimationFrame(step); })"""
    await pg.evaluate(js, [to, ms, el])


class Clock:
    def __init__(self, sid):
        self.sid, self.t0 = sid, time.monotonic()
        MARKS[sid] = {}

    def mark(self, name):
        MARKS[self.sid][name] = round(time.monotonic() - self.t0, 2)


async def s1(pg, T, c):
    await pg.goto(BASE + "/"); await pg.wait_for_timeout(T * 0.5 * 1000)
    await smooth_scroll(pg, 950, T * 0.45 * 1000)


async def s2(pg, T, c):
    await pg.goto(BASE + "/app")
    await pg.get_by_role("button", name="Next →").wait_for(timeout=60000)
    c.mark("start"); await pg.wait_for_timeout(4000)
    await pg.get_by_role("button", name="Next →").click(); await pg.wait_for_timeout(4500)
    await pg.get_by_role("button", name="Skip").click(); await pg.wait_for_timeout(max(3000, (T - 17) * 1000))
    await pg.get_by_role("button", name="◧ Legend").click(); await pg.wait_for_timeout(4500)
    await pg.get_by_role("button", name="◧ Legend").click(); await pg.wait_for_timeout(1000)


async def s3(pg, T, c):
    await pg.goto(BASE + "/app")
    btn = pg.get_by_role("button", name="⌖ Use my location")
    await btn.wait_for(timeout=60000); c.mark("start"); await pg.wait_for_timeout(2500)
    await btn.click(); await pg.wait_for_timeout(9000)
    await smooth_scroll(pg, 280, 3000, PANEL); await pg.wait_for_timeout(max(2000, (T - 13) * 1000))


async def s4(pg, T, c):
    await pg.goto(BASE + "/app?mode=place&lat=28.63150&lon=77.21670")
    b3 = pg.get_by_role("button", name="◳ 3D city")
    await b3.wait_for(timeout=90000); c.mark("start"); await pg.wait_for_timeout(4500)
    await smooth_scroll(pg, 420, 2500, PANEL); await pg.wait_for_timeout(1500)
    await smooth_scroll(pg, 0, 1200, PANEL)
    await b3.click()
    await pg.get_by_text(re.compile(r"buildings within")).wait_for(timeout=60000)
    await pg.wait_for_timeout(11000)
    sv = pg.get_by_role("button", name="◉ Street View 360°")
    if await sv.count():
        await sv.click(); await pg.wait_for_timeout(6500)
        await pg.locator(".sv-modal .x").click(); await pg.wait_for_timeout(1500)


async def s5(pg, T, c):
    await pg.goto(BASE + "/app?mode=detect")
    await pg.get_by_role("button", name="India", exact=True).wait_for(timeout=60000)
    await pg.get_by_role("button", name="India", exact=True).click()
    rows = pg.locator(".mc-panel .list .row")
    await rows.first.wait_for(timeout=90000); c.mark("start"); await pg.wait_for_timeout(3500)
    await rows.first.click(); await pg.wait_for_timeout(8000)
    await smooth_scroll(pg, 700, 3500, PANEL); await pg.wait_for_timeout(max(2000, (T - 15) * 1000))


async def s6(pg, T, c):
    await pg.goto(BASE + "/app")
    btn = pg.get_by_role("button", name="✦ Copilot")
    await btn.wait_for(timeout=60000); await pg.wait_for_timeout(3000); c.mark("start")
    await btn.click(); await pg.wait_for_timeout(900)
    await pg.locator(".ask-in input").type("Which schools in Delhi should keep children indoors today? Draft a notice to principals in Hindi.", delay=28)
    await pg.wait_for_timeout(500)
    await pg.get_by_role("button", name="Ask", exact=True).click(); c.mark("send")
    await pg.wait_for_selector(".msg.a .msg-foot", timeout=150000); c.mark("done")
    await pg.wait_for_timeout(9500)           # the agent's actions play: fly to Delhi, open Protect, open the draft
    await pg.locator(".ask .x").click(); await pg.wait_for_timeout(2500)
    await smooth_scroll(pg, 520, 3500, PANEL); await pg.wait_for_timeout(2000)


async def s7(pg, T, c):
    await pg.goto(BASE + "/app?mode=citizen")
    sel = pg.locator('.mc-panel select[aria-label="Your language"]')
    await sel.wait_for(timeout=60000); c.mark("start"); await pg.wait_for_timeout(1500)
    await sel.select_option("pa"); await pg.wait_for_timeout(800)
    await pg.get_by_role("button", name="⌖ My location").click(); await pg.wait_for_timeout(2000)
    await pg.set_input_files('[data-testid="voice-file"]', str(OUT / "voice_pa.wav")); await pg.wait_for_timeout(1500)
    await pg.get_by_role("button", name="Send report").click(); c.mark("send")
    await pg.wait_for_selector(".report-hero", timeout=150000); c.mark("done")
    await pg.wait_for_timeout(3500)
    await smooth_scroll(pg, 520, 4000, PANEL); await pg.wait_for_timeout(2500)
    await smooth_scroll(pg, 1400, 4000, PANEL); await pg.wait_for_timeout(4000)


async def s8(pg, T, c):
    await pg.goto(BASE + "/app?mode=trace")
    sel = pg.locator(".mc-panel select.select").first
    await sel.wait_for(timeout=60000); c.mark("start")
    await sel.select_option("delhi"); c.mark("send")
    await pg.wait_for_selector(".src-legend", timeout=150000); c.mark("done")
    await pg.wait_for_timeout(5000)
    await smooth_scroll(pg, 420, 4000, PANEL); await pg.wait_for_timeout(4000)


async def s9(pg, T, c):
    await pg.goto(BASE + "/app?mode=command")
    draft = pg.get_by_role("button", name="Draft", exact=True).first
    await draft.wait_for(timeout=60000); c.mark("start"); await pg.wait_for_timeout(2500)
    await draft.click(); await pg.wait_for_timeout(2500)
    await pg.get_by_role("button", name="✦ Draft with Gemini").click(); c.mark("send")
    await pg.wait_for_selector(".flow", timeout=150000); c.mark("done")
    await pg.wait_for_timeout(2500)
    await smooth_scroll(pg, 520, 3000, PANEL); await pg.wait_for_timeout(1500)
    await smooth_scroll(pg, 1000, 2500, PANEL)
    seg = pg.locator(".mc-panel .seg button")
    if await seg.count() > 1:
        await seg.nth(1).click(); await pg.wait_for_timeout(2200)
    await smooth_scroll(pg, 1600, 2500, PANEL); await pg.wait_for_timeout(800)
    for label in ("Approve", "Dispatch"):
        b = pg.get_by_role("button", name=re.compile(f"^{label}"))
        if await b.count():
            await b.first.click(); await pg.wait_for_timeout(1800)
    await smooth_scroll(pg, 4000, 2000, PANEL); await pg.wait_for_timeout(1500)


async def s10(pg, T, c):
    await pg.goto(BASE + "/app?mode=commons")
    await pg.locator(".mc-panel .lede").first.wait_for(timeout=60000); c.mark("start")
    await pg.wait_for_timeout(7000)
    await smooth_scroll(pg, 420, 5000, PANEL); await pg.wait_for_timeout(4500)
    await smooth_scroll(pg, 900, 5000, PANEL); await pg.wait_for_timeout(max(1000, (T - 21) * 1000))


async def s11(pg, T, c):
    await pg.goto(BASE + "/#stack"); await pg.wait_for_timeout(2500)
    y = await pg.evaluate("document.querySelector('#stack').offsetTop")
    await pg.evaluate(f"scrollTo(0,{y})"); c.mark("start"); await pg.wait_for_timeout(T * 0.4 * 1000)
    fy = await pg.evaluate("document.querySelector('#final').offsetTop")
    await smooth_scroll(pg, fy, 5000); await pg.wait_for_timeout(T * 0.45 * 1000)


SCENES = {f"s{i}": f for i, f in enumerate([s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11], 1)}
GEO = {"s3": (13.0827, 80.2707), "s7": (31.6340, 74.8723)}


async def main(which):
    mf = OUT / "marks.json"
    if mf.exists():
        MARKS.update(json.loads(mf.read_text()))
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", args=ARGS)
        for sid in which:
            T = dur(OUT / f"{sid}.wav")
            tmp = OUT / f"rec_{sid}"
            shutil.rmtree(tmp, ignore_errors=True)
            lat, lon = GEO.get(sid, (28.6139, 77.2090))
            ctx = await b.new_context(viewport={"width": W, "height": H}, record_video_dir=str(tmp),
                                      record_video_size={"width": W, "height": H},
                                      geolocation={"latitude": lat, "longitude": lon}, permissions=["geolocation"])
            if sid != "s2":
                await ctx.add_init_script(ONBOARDED)
            pg = await ctx.new_page()
            c = Clock(sid)
            try:
                await SCENES[sid](pg, T, c)
            except Exception as e:
                print(sid, "ERROR", type(e).__name__, str(e)[:300])
            c.mark("end")
            await ctx.close()
            vids = list(tmp.glob("*.webm"))
            if vids:
                vids[0].replace(OUT / f"{sid}.webm")
            shutil.rmtree(tmp, ignore_errors=True)
            print("recorded", sid, round(T, 1), MARKS[sid])
            mf.write_text(json.dumps(MARKS, indent=1))
        await b.close()

asyncio.run(main(sys.argv[1].split(",") if len(sys.argv) > 1 else list(SCENES)))
