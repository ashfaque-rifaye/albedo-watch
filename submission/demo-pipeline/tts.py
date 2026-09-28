import json, sys, time, pathlib
sys.path.insert(0, r"D:\Projects\AI for Communities\Project ABC\backend")
from app.llm.gemini_provider import GeminiProvider
g = GeminiProvider()
out = pathlib.Path(sys.argv[1])
items = json.loads((out / "script.json").read_text(encoding="utf-8"))
items.append({"id": "voice_pa", "voice": "Algenib", "raw": True,
  "text": "Say it like a worried farmer speaking into a phone outdoors, natural pace: ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਜੀ। ਅੰਮ੍ਰਿਤਸਰ ਦੇ ਨੇੜੇ ਸਾਡੇ ਪਿੰਡ ਦੇ ਖੇਤਾਂ ਵਿੱਚ ਸਵੇਰ ਤੋਂ ਪਰਾਲੀ ਸਾੜੀ ਜਾ ਰਹੀ ਹੈ। ਬਹੁਤ ਸੰਘਣਾ ਧੂੰਆਂ ਹੈ, ਬੱਚਿਆਂ ਨੂੰ ਸਾਹ ਲੈਣ ਵਿੱਚ ਤਕਲੀਫ਼ ਹੋ ਰਹੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਕੁਝ ਕਰੋ।"})
for it in items:
    f = out / f"{it['id']}.wav"
    if f.exists(): continue
    text = it["text"] if it.get("raw") else "Read this as a calm, confident documentary narrator with a warm Indian English accent, measured pace: " + it["text"]
    for attempt in range(4):
        r = g.speak(text, it.get("voice", "Charon"))
        if r: f.write_bytes(r[0]); print("ok", it["id"], len(r[0])); break
        time.sleep(20)
    else: print("FAILED", it["id"])
    time.sleep(6)
