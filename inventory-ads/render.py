"""Rendering: HeyGen makes the talking spokesperson on a green screen, Shotstack keys out the
green and composites them over the car photos with captions, price and an end card.

Env vars: HEYGEN_API_KEY, HEYGEN_AVATAR_ID, HEYGEN_VOICE_ID, SHOTSTACK_API_KEY,
          SHOTSTACK_ENV (stage = free watermarked test renders, v1 = production)
"""
from __future__ import annotations

import os
import time

import requests

from feed import Vehicle

GREEN = "#00B140"
LOGO = ("https://dcdws.blob.core.windows.net/dws-21794935-108180-media/sites/108180/2026/02/"
        "cropped-GOLDEN-AUTO-COLOR-LOGO-NO-BG.png")
BRAND_GOLD = "#E8B33A"
PHONE = "925-230-1400"
END_CARD_SECONDS = 3.5

FORMATS = {                 # Reels/Stories and Feed
    "9x16": (1080, 1920),
    "4x5": (1080, 1350),
}


# ------------------------------------------------------------------ HeyGen
class HeyGen:
    BASE = "https://api.heygen.com"

    def __init__(self):
        self.h = {"X-Api-Key": os.environ["HEYGEN_API_KEY"], "Content-Type": "application/json"}

    def spokesperson(self, text: str, title: str) -> dict:
        """Render the presenter speaking `text` on solid green, 1080x1920. Returns {url, duration}."""
        body = {
            "title": title,
            "caption": False,                       # captions are added in Shotstack
            "dimension": {"width": 1080, "height": 1920},
            "video_inputs": [{
                "character": {"type": "avatar", "avatar_id": os.environ["HEYGEN_AVATAR_ID"],
                              "avatar_style": "normal"},
                "voice": {"type": "text", "voice_id": os.environ["HEYGEN_VOICE_ID"],
                          "input_text": text, "speed": 1.05, "emotion": "Friendly"},
                "background": {"type": "color", "value": GREEN},
            }],
        }
        r = requests.post(f"{self.BASE}/v2/video/generate", headers=self.h, json=body, timeout=60)
        r.raise_for_status()
        vid = r.json()["data"]["video_id"]
        while True:
            s = requests.get(f"{self.BASE}/v1/video_status.get", headers=self.h,
                             params={"video_id": vid}, timeout=30).json()["data"]
            if s["status"] == "completed":
                return {"url": s["video_url"], "duration": float(s["duration"])}
            if s["status"] == "failed":
                raise RuntimeError(f"HeyGen failed: {s.get('error')}")
            time.sleep(15)


# ------------------------------------------------------------------ Shotstack timeline
def _oy(px: float, H: int) -> float:   # Shotstack offsets are fractions of the frame, +y = up
    return round((H / 2 - px) / H, 4)


def _ox(px: float, W: int) -> float:
    return round((px - W / 2) / W, 4)


def _text(text, size, color="#FFFFFF", bg=None, weight=800, w=1000, h=140, **clip):
    asset = {"type": "rich-text", "text": text,
             "font": {"family": "Montserrat", "size": size, "weight": weight, "color": color},
             "stroke": {"width": 0 if bg else 3, "color": "#000000"}, "padding": 16}
    if bg:
        asset["background"] = {"color": bg, "borderRadius": 22, "wrap": True}
    return {"asset": asset, "width": w, "height": h, **clip}


def build_timeline(v: Vehicle, script: dict, presenter: dict, fmt: str = "9x16") -> dict:
    W, H = FORMATS[fmt]
    tall = fmt == "9x16"
    D = presenter["duration"]
    photos = [v.photos[i] for i in script["photo_order"]] or v.photos[:6]
    per = D / len(photos)

    photo_center = 540 if tall else 400          # px from top where the car photo band sits
    bg, band = [], []
    for i, src in enumerate(photos):
        t = round(i * per, 2)
        bg.append({"asset": {"type": "image", "src": src}, "start": t, "length": round(per, 2),
                   "fit": "cover", "filter": "blur", "opacity": 0.55})
        band.append({"asset": {"type": "image", "src": src}, "start": t, "length": round(per, 2),
                     "fit": "contain", "offset": {"x": 0, "y": _oy(photo_center, H)},
                     "effect": "zoomInSlow" if i % 2 == 0 else "slideLeftSlow",
                     "transition": {"in": "fade", "out": "fade"}})

    overlays = [
        _text(script["hook_text"], 64 if tall else 54, start=0, length=min(3.5, D),
              position="top", offset={"x": 0, "y": -0.02}),
        _text("   •   ".join(script["spec_chips"]), 38, start=0.5, length=D - 0.5, w=1040, h=90,
              offset={"x": 0, "y": _oy(photo_center + 345 if tall else photo_center + 300, H)}),
    ]
    if script.get("price_badge"):
        overlays.append(_text(script["price_badge"], 54, color="#111111", bg=BRAND_GOLD, start=1, length=D - 1,
                              w=800, h=110,
                              offset={"x": 0, "y": _oy(photo_center + 440 if tall else photo_center + 390, H)}))

    captions = {
        "asset": {"type": "rich-caption", "src": "alias://presenter",
                  "font": {"family": "Montserrat", "size": 52 if tall else 44, "weight": 800, "color": "#FFFFFF"},
                  "stroke": {"width": 3, "color": "#000000"},
                  "animation": {"style": "highlight"},
                  "active": {"font": {"color": BRAND_GOLD}},
                  "align": {"horizontal": "left", "vertical": "middle"},
                  "style": {"textTransform": "uppercase"}},
        "start": 0, "length": D, "width": 600, "height": 360 if tall else 260,
        "position": "left", "offset": {"x": 0.03, "y": _oy(H * (0.75 if tall else 0.78), H)},
    }

    presenter_clip = {
        "alias": "presenter",
        "asset": {"type": "video", "src": presenter["url"],
                  "chromaKey": {"color": GREEN, "threshold": 150, "halo": 100}},
        "start": 0, "length": D,
        "position": "bottomRight", "scale": 0.62 if tall else 0.5, "offset": {"x": 0.12, "y": 0},
    }

    end = [
        {"asset": {"type": "image", "src": LOGO}, "start": D, "length": END_CARD_SECONDS,
         "scale": 0.5, "offset": {"x": 0, "y": 0.18}, "transition": {"in": "fade"}},
        _text(script["cta_text"], 60, start=D, length=END_CARD_SECONDS, w=1000, h=200,
              offset={"x": 0, "y": 0}),
        _text(f"Call or text {PHONE}", 52, color="#111111", bg=BRAND_GOLD, start=D,
              length=END_CARD_SECONDS, w=900, h=110, offset={"x": 0, "y": -0.1}),
        # Identify the specific vehicle (CA requires VIN or plate in used-vehicle ads; stock # helps the lot)
        _text(f"{v.title}  •  Stock {v.stock}  •  VIN {v.vin}", 26, weight=500, start=D,
              length=END_CARD_SECONDS, w=1040, h=80, offset={"x": 0, "y": -0.2}),
        _text("2092 Omega Rd, San Ramon  •  Price + tax & registration", 26, weight=500, start=D,
              length=END_CARD_SECONDS, w=1040, h=80, offset={"x": 0, "y": -0.26}),
    ]

    timeline = {
        "background": "#0B0B0B",
        # first track renders on top
        "tracks": [{"clips": end}, {"clips": [captions]}, {"clips": [presenter_clip]},
                   {"clips": overlays}, {"clips": band}, {"clips": bg}],
    }
    if os.getenv("MUSIC_URL"):
        timeline["soundtrack"] = {"src": os.environ["MUSIC_URL"], "effect": "fadeOut", "volume": 0.12}

    return {"timeline": timeline,
            "output": {"format": "mp4", "size": {"width": W, "height": H}, "fps": 30}}


class Shotstack:
    def __init__(self):
        env = os.getenv("SHOTSTACK_ENV", "stage")
        self.base = f"https://api.shotstack.io/edit/{env}"
        self.h = {"x-api-key": os.environ["SHOTSTACK_API_KEY"], "Content-Type": "application/json"}

    def render(self, edit: dict) -> str:
        r = requests.post(f"{self.base}/render", headers=self.h, json=edit, timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"Shotstack {r.status_code}: {r.text}")
        rid = r.json()["response"]["id"]
        while True:
            s = requests.get(f"{self.base}/render/{rid}", headers=self.h, timeout=30).json()["response"]
            if s["status"] == "done":
                return s["url"]
            if s["status"] == "failed":
                raise RuntimeError(f"Shotstack failed: {s.get('error')}")
            time.sleep(10)
