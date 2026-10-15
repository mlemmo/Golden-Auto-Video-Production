"""Headless version of scrape_inventory.js for the server.

Opens mygoldenauto.net in headless Chromium (the site blocks plain HTTP clients),
runs the same scraper and writes inventory.json.

  python fetch_inventory.py [output.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = "https://www.mygoldenauto.net/"
HERE = Path(__file__).resolve().parent


def fetch(out: Path) -> int:
    js = (HERE / "scrape_inventory.js").read_text().strip().rstrip(";")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/141.0 Safari/537.36"))
        page.goto(SITE, wait_until="networkidle", timeout=90_000)
        page.wait_for_selector('a[href*="/inventory/"]', timeout=60_000)
        page.evaluate("window.__GA_RETURN = true")
        data = page.evaluate(js)
        browser.close()
    if not data or not data.get("vehicles"):
        raise SystemExit("Scrape returned no vehicles — not overwriting the previous inventory")
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(out)                       # atomic: a failed scrape never leaves a half file
    return len(data["vehicles"])


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "inventory.json")
    print(f"{fetch(out)} vehicles -> {out}")
