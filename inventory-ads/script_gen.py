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
5. Open with a 1-sentence hook about who the car is for. End with exactly this sentence: \
"Call or text nine two five, two three zero, one four zero zero, or tap to see it at Golden Auto in San Ramon."

PHOTOS
You get the photos as a numbered list in the order the dealer uploaded them. You cannot see \
them. Dealers usually shoot front three-quarter first, then sides, rear, interior, then details. \
Pick 6–8 indices for the slideshow, keeping the first photo first.

Return the result by calling the ad_script tool (or, if you cannot, as one JSON object with the same fields)."""

AD_SCRIPT_TOOL = {
    "name": "ad_script",
    "description": "Return the finished ad script and on-screen elements for one vehicle.",
    "input_schema": {
        "type": "object",
        "properties": {
            "hook_text": {"type": "string", "description": "On-screen headline, max 6 words"},
            "spoken_script": {"type": "string", "description": "What the spokesperson says, 55-75 words"},
            "price_badge": {"type": "string", "description": "e.g. Just $14,688"},
            "spec_chips": {"type": "array", "items": {"type": "string"},
                           "description": "3-4 short on-screen chips from the facts, e.g. 81K miles, 4WD"},
            "photo_order": {"type": "array", "items": {"type": "integer"},
                            "description": "6-8 photo indices, first photo first"},
            "cta_text": {"type": "string", "description": "End card line, max 8 words"},
        },
        "required": ["hook_text", "spoken_script", "price_badge", "spec_chips", "photo_order", "cta_text"],
    },
}


def make_client() -> anthropic.Anthropic:
    """Keys not scoped to a workspace must name one with the anthropic-workspace-id header."""
    ws = os.getenv("ANTHROPIC_WORKSPACE_ID", "").strip()
    return anthropic.Anthropic(default_headers={"anthropic-workspace-id": ws} if ws else None)


def write_script(v: Vehicle, client: anthropic.Anthropic | None = None) -> dict:
    client = client or make_client()
    user = {
        "VEHICLE_FACTS": v.facts(),
        "PHOTOS": [f"{i}: {u.rsplit('/', 1)[-1]}" for i, u in enumerate(v.photos[:20])],
    }
    msg = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        tools=[AD_SCRIPT_TOOL],
        messages=[{"role": "user", "content": json.dumps(user, indent=2)}],
    )
    script = next((b.input for b in msg.content if b.type == "tool_use"), None)
    if not isinstance(script, dict):                 # model answered in text: take the JSON object from it
        text = "".join(getattr(b, "text", "") for b in msg.content if b.type == "text")
        i, j = text.find("{"), text.rfind("}")
        try:
            script = json.loads(text[i:j + 1]) if i >= 0 < j else None
        except json.JSONDecodeError:
            script = None
    if not isinstance(script, dict) or "spoken_script" not in script:
        raw = "\n".join(getattr(b, "text", "") or str(getattr(b, "input", "")) for b in msg.content)
        raise ValueError(f"no script returned (model={msg.model}, stop={msg.stop_reason}): {raw[:300]!r}")
    validate(script, v)
    return script


CTA = ("Call or text nine two five, two three zero, one four zero zero, "
       "or tap to see it at Golden Auto in San Ramon.")
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " \
       "seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def words(n: int) -> str:
    """0-999 in words, for spoken mileage like '253 thousand'."""
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")
    return ONES[n // 100] + " hundred" + (" " + words(n % 100) if n % 100 else "")


def tidy_speech(text: str) -> str:
    """Same phone wording every time; numerals before 'thousand' spelled out."""
    import re
    i = text.lower().rfind("call or text")
    text = (text[:i].rstrip() + " " + CTA) if i >= 0 else (text.rstrip() + " " + CTA)
    text = re.sub(r"\b(\d{1,3})(?= thousand)", lambda m: words(int(m.group(1))), text)
    return re.sub(r"\bpriced at just\b", "Just", re.sub(r"\bIt's priced at just\b", "Just", text))


def validate(s: dict, v: Vehicle) -> None:
    """Cheap guardrails before spending money on a render."""
    s["spoken_script"] = tidy_speech(s["spoken_script"])
    words = len(s["spoken_script"].split())
    if not 40 <= words <= 90:
        raise ValueError(f"{v.stock}: script is {words} words")
    n = len(v.photos)
    s["photo_order"] = [i for i in s["photo_order"] if isinstance(i, int) and 0 <= i < n] or list(range(min(n, 7)))
    if v.price_advertised and s.get("price_badge"):
        want = f"{round(v.price_advertised):,}"
        if want not in s["price_badge"]:
            s["price_badge"] = f"Just ${want}"
