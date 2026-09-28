"""Record Albedo-Watch demo scenes with Playwright (one video per scene)."""
import asyncio, json, pathlib, shutil, subprocess, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:8011"
OUT = pathlib.Path(__file__).parent
W, H = 1600, 900
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def dur(wav):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)], capture_output=True, text=True)
    return float(r.stdout.strip())


async def smooth_scroll(pg, to, ms, el="window"):
    js = """([to, ms, sel]) => new Promise(r => {
      const t = sel === 'window' ? null : document.querySelector(sel);
      const from = t ? t.scrollTop : scrollY, t0 = performance.now();
      const step = (n) => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2;
        const y = from + (to - from) * e; t ? (t.scrollTop = y) : scrollTo(0, y); k < 1 ? requestAnimationFrame(step) : r(); };
      requestAnimationFrame(step); })"""
    await pg.evaluate(js, [to, ms, el])


PANEL = ".mc-panel-body"


async def s1(pg, T):
    await pg.goto(BASE + "/"); await pg.wait_for_timeout(T * 0.45 * 1000)
    await smooth_scroll(pg, 900, T * 0.5 * 1000)


async def s2(pg, T):
    await pg.goto(BASE + "/#numbers"); await pg.wait_for_timeout(1500)
    y = await pg.evaluate("document.querySelector('#numbers').offsetTop")
    await pg.evaluate(f"scrollTo(0,{y})"); await pg.wait_for_timeout(3500)
    await smooth_scroll(pg, y + 700, 6000)
    ly = await pg.evaluate("document.querySelector('#loop').offsetTop")
    await smooth_scroll(pg, ly + 200, 4000)
    await smooth_scroll(pg, ly + 2600, (T - 15) * 1000)


async def s3(pg, T):
    await pg.goto(BASE + "/app?mode=pulse"); await pg.wait_for_timeout(9000)
    await pg.get_by_role("button", name="Play forecast").click()
    await pg.wait_for_timeout(9000)
    await pg.get_by_role("button", name="Pause").click()
    await pg.locator(".row", has_text="Panipat").first.click()
    await pg.wait_for_timeout(5000)
    await smooth_scroll(pg, 380, 3000, PANEL)
    await pg.wait_for_timeout(max(1000, (T - 27) * 1000))


async def s4(pg, T):
    await pg.goto(BASE + "/app?mode=detect"); await pg.wait_for_timeout(8000)
    await pg.locator(".row", has_text="Amritsar").first.click()
    await pg.wait_for_timeout(6000)
    await smooth_scroll(pg, 500, 5000, PANEL)
    await pg.wait_for_timeout(max(1000, (T - 19) * 1000))


async def s5(pg, T):
    await pg.goto(BASE + "/app?mode=citizen"); await pg.wait_for_timeout(6000)
    await pg.select_option(".mc-panel select.select", "pa")
    await pg.get_by_role("button", name="⌖ Use my location").click()
    await pg.wait_for_timeout(3000)
    await pg.set_input_files('[data-testid="voice-file"]', str(OUT / "voice_pa.wav"))
    await pg.wait_for_timeout(1500)
    await pg.get_by_role("button", name="Send report").click()
    await pg.wait_for_selector(".report-hero", timeout=150000)
    await pg.wait_for_timeout(3500)
    await smooth_scroll(pg, 520, 4000, PANEL); await pg.wait_for_timeout(2500)
    await smooth_scroll(pg, 1400, 4000, PANEL); await pg.wait_for_timeout(4000)


async def s6(pg, T):
    await pg.goto(BASE + "/app?mode=trace"); await pg.wait_for_timeout(2500)
    await pg.select_option(".mc-panel select.select", "ludhiana")
    await pg.wait_for_selector(".src-legend", timeout=150000)
    await pg.wait_for_timeout(6000)
    await smooth_scroll(pg, 420, 4000, PANEL); await pg.wait_for_timeout(4000)
    await smooth_scroll(pg, 1000, 4000, PANEL); await pg.wait_for_timeout(2000)
    await pg.locator(".measure", has_text="Halt construction").click(); await pg.wait_for_timeout(1500)
    await pg.locator(".measure", has_text="truck entry").click(); await pg.wait_for_timeout(1500)
    await pg.locator(".measure", has_text="non-PNG").click(); await pg.wait_for_timeout(3000)


async def s7(pg, T):
    await pg.goto(BASE + "/app?mode=command"); await pg.wait_for_timeout(5000)
    await pg.locator(".row", has_text="Panipat").get_by_role("button", name="Draft").click()
    await pg.wait_for_selector(".flow", timeout=150000); await pg.wait_for_timeout(4000)
    await smooth_scroll(pg, 520, 4000, PANEL); await pg.wait_for_timeout(2500)
    await smooth_scroll(pg, 980, 3000, PANEL)
    seg = pg.locator(".seg button")
    if await seg.count() > 1:
        await seg.nth(1).click(); await pg.wait_for_timeout(3000)
    await smooth_scroll(pg, 1500, 3000, PANEL); await pg.wait_for_timeout(1500)
    for label in ("Approve →", "Dispatch →"):
        await pg.get_by_role("button", name=label).click(); await pg.wait_for_timeout(2200)
    await smooth_scroll(pg, 4000, 2500, PANEL); await pg.wait_for_timeout(2500)


async def s8(pg, T):
    await pg.goto(BASE + "/app?mode=commons"); await pg.wait_for_timeout(9000)
    await smooth_scroll(pg, 330, 5000, PANEL); await pg.wait_for_timeout(5000)
    await smooth_scroll(pg, 800, 5000, PANEL); await pg.wait_for_timeout(max(1000, (T - 24) * 1000))


async def s9(pg, T):
    await pg.goto(BASE + "/#stack"); await pg.wait_for_timeout(1500)
    y = await pg.evaluate("document.querySelector('#stack').offsetTop")
    await pg.evaluate(f"scrollTo(0,{y})"); await pg.wait_for_timeout(T * 0.35 * 1000)
    fy = await pg.evaluate("document.querySelector('#final').offsetTop")
    await smooth_scroll(pg, fy, 5000); await pg.wait_for_timeout(T * 0.45 * 1000)


SCENES = {"s1": s1, "s2": s2, "s3": s3, "s4": s4, "s5": s5, "s6": s6, "s7": s7, "s8": s8, "s9": s9}


async def main(which):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", args=ARGS)
        for sid in which:
            T = dur(OUT / f"{sid}.wav")
            tmp = OUT / f"rec_{sid}"
            shutil.rmtree(tmp, ignore_errors=True)
            ctx = await b.new_context(viewport={"width": W, "height": H}, record_video_dir=str(tmp),
                                      record_video_size={"width": W, "height": H},
                                      geolocation={"latitude": 31.7052, "longitude": 74.7448}, permissions=["geolocation"])
            pg = await ctx.new_page()
            try:
                await SCENES[sid](pg, T)
            except Exception as e:
                print(sid, "ERROR", type(e).__name__, str(e)[:300])
            await ctx.close()
            vids = list(tmp.glob("*.webm"))
            if vids:
                vids[0].replace(OUT / f"{sid}.webm")
            shutil.rmtree(tmp, ignore_errors=True)
            print("recorded", sid, round(T, 1))
        await b.close()

asyncio.run(main(sys.argv[1].split(",") if len(sys.argv) > 1 else list(SCENES)))
