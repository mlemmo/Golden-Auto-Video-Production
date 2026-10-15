"""Run the whole thing.

  python pipeline.py inventory.json --dry-run        # scripts + Shotstack JSON only, no render spend
  python pipeline.py inventory.json --only A13806    # one car end to end
  python pipeline.py dealercenter_export.xml          # every new car in the feed

Keeps state.json so a car is only rendered once (re-rendered if its price changes),
and writes ads.csv listing current-inventory videos for upload to Meta.
Cars that disappear from the feed are marked sold and drop out of ads.csv.
A car that fails is logged and retried on the next run.
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

from feed import load_inventory
from render import FORMATS, HeyGen, Shotstack, build_timeline
from script_gen import make_client, write_script

OUT = Path("out")
STATE = Path("state.json")
_heygen: HeyGen | None = None
_shot: Shotstack | None = None
_claude = None


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def process(v, a, state: dict) -> None:
    global _heygen, _shot, _claude
    _claude = _claude or make_client()
    script = write_script(v, _claude)
    (OUT / f"{v.stock}_script.json").write_text(json.dumps(script, indent=2))
    print(script["spoken_script"], flush=True)

    if a.dry_run:
        fake = {"url": "https://example.com/presenter.mp4", "duration": 24.0}
        for fmt in a.formats.split(","):
            (OUT / f"{v.stock}_{fmt}_edit.json").write_text(
                json.dumps(build_timeline(v, script, fake, fmt), indent=2))
        return

    _heygen, _shot = _heygen or HeyGen(), _shot or Shotstack()
    presenter = _heygen.spokesperson(script["spoken_script"], f"{v.stock} {v.title}")
    files = {}
    for fmt in a.formats.split(","):
        url = _shot.render(build_timeline(v, script, presenter, fmt))
        path = OUT / f"{v.stock}_{fmt}.mp4"            # Shotstack URLs expire, keep our own copy
        path.write_bytes(requests.get(url, timeout=300).content)
        files[fmt] = str(path)
        print(f"  {fmt}: {path}", flush=True)

    state[v.key] = {"stock": v.stock, "title": v.title, "price": v.price_advertised, "url": v.url,
                    "files": files, "status": "live", "rendered_at": now()}
    STATE.write_text(json.dumps(state, indent=2))


def write_outputs(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2))
    with open("ads.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["vin", "stock", "title", "price", "landing_url", "video_9x16", "video_4x5"])
        for vin, s in state.items():
            if s.get("status") == "live":
                w.writerow([vin, s["stock"], s["title"], s["price"], s["url"],
                            s["files"].get("9x16", ""), s["files"].get("4x5", "")])
    print("ads.csv written", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("feed")
    ap.add_argument("--only", help="comma-separated stock numbers")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--formats", default=",".join(FORMATS))
    a = ap.parse_args()

    OUT.mkdir(exist_ok=True)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    vehicles = load_inventory(a.feed)
    live = {v.key for v in vehicles}

    for vin, s in state.items():                        # sold cars come out of the ad set
        if vin not in live and s.get("status") != "sold":
            s["status"], s["sold_at"] = "sold", now()
            print(f"sold: {s['stock']} {s['title']}", flush=True)

    only = {x.strip().upper() for x in a.only.split(",")} if a.only else None
    todo = [v for v in vehicles
            if (not only or v.stock.upper() in only)
            and (a.dry_run or state.get(v.key, {}).get("price") != v.price_advertised)]
    print(f"{len(vehicles)} in feed, {len(todo)} to process", flush=True)

    for v in todo:
        if len(v.photos) < 3:
            print(f"skip {v.stock}: only {len(v.photos)} photos")
            continue
        print(f"\n== {v.stock} {v.title}", flush=True)
        try:
            process(v, a, state)
        except Exception as e:                           # one bad car shouldn't stop the run
            print(f"  FAILED {v.stock}: {e}", flush=True)

    write_outputs(state)


if __name__ == "__main__":
    main()
