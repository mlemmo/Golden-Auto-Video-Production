"""Write the spokesperson script for one vehicle with Claude.

The model only sees the vehicle's feed facts, and must return JSON. Every claim in the
script has to come from those facts — no invented features, condition claims or financing.
"""
from __future__ import annotations

import json
import os

import anthropic

from feed import Vehicle

MODEL = os.getenv("SCRIPT_MODEL", "claude-sonnet-5-5")

SYSTEM_PROMPT = """You write 20–30 second spokesperson scripts for vertical social video ads \
(Instagram Reels, Facebook Reels and Stories) for Golden Auto, a used-car dealer at \
2092 Omega Rd, San Ramon, CA. Phone 925-230-1400.

The spokesperson is a friendly, confident local salesperson talking straight to camera while \
photos of the car play beside them. Plain spoken American English. No hype words like \
"insane", "unbelievable", "steal". No emojis.

HARD RULES
1. Use ONLY facts present in VEHICLE_FACTS. Never invent features, options, condition, \
accident history, warranty, ownership count, financing terms, monthly payments or discounts. \
If the description field mentions a feature, you may use it; otherwise don't.
2. Say the price as "Just" plus price_advertised in whole dollars (e.g. "Just fourteen thousand six \
hundred eighty-eight dollars"); never say cents or any other price. Golden Auto's ads always use "Just".
3. Say mileage as a rounded figure ("about 82 thousand miles").
4. 55–75 spoken words total. Write numbers the way they should be spoken \
("twenty eighteen", "three point five liter"). Spell letter codes with hyphens so the voice reads \
them as letters: SUV -> "S-U-V", XV -> "X-V", CR-V -> "C-R-V", AWD -> "all-wheel drive". The website is \
"my golden auto dot net".
5. Open with a 1-sentence hook about who the car is for. End with the call to action: \
call or text 925-230-1400 or tap to see it at Golden Auto in San Ramon.

PHOTOS
You get the photos as a numbered list in the order the dealer uploaded them. You cannot see \
them. Dealers usually shoot front three-quarter first, then sides, rear, interior, then details. \
Pick 6–8 indices for the slideshow, keeping the first photo first.

Return ONLY this JSON, no prose:
{
  "hook_text": "<on-screen headline, max 6 words>",
  "spoken_script": "<what the spokesperson says>",
  "price_badge": "<e.g. Just $14,688>",
  "spec_chips": ["<3-4 short on-screen chips taken from the facts, e.g. '81K miles', '4WD', 'V6 EcoBoost'>"],
  "photo_order": [<photo indices>],
  "cta_text": "<end card line, max 8 words>"
}"""


def write_script(v: Vehicle, client: anthropic.Anthropic | None = None) -> dict:
    client = client or anthropic.Anthropic()
    user = {
        "VEHICLE_FACTS": v.facts(),
        "PHOTOS": [f"{i}: {u.rsplit('/', 1)[-1]}" for i, u in enumerate(v.photos[:20])],
    }
    msg = client.messages.create(
        model=MODEL,
        max_tokens=800,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(user, indent=2)}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    text = text[text.find("{"): text.rfind("}") + 1]
    script = json.loads(text)
    validate(script, v)
    return script


def validate(s: dict, v: Vehicle) -> None:
    """Cheap guardrails before spending money on a render."""
    words = len(s["spoken_script"].split())
    if not 40 <= words <= 90:
        raise ValueError(f"{v.stock}: script is {words} words")
    n = len(v.photos)
    s["photo_order"] = [i for i in s["photo_order"] if isinstance(i, int) and 0 <= i < n] or list(range(min(n, 7)))
    if v.price_advertised and s.get("price_badge"):
        want = f"{round(v.price_advertised):,}"
        if want not in s["price_badge"]:
            s["price_badge"] = f"Just ${want}"
