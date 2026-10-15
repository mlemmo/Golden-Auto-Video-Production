"""List the HeyGen avatars, photo avatars and voices on your account, with the IDs .env needs.

  set -a; source /opt/goldenauto-video/.env; set +a
  /opt/goldenauto-video/venv/bin/python /opt/goldenauto-video/heygen_ids.py [--all-voices]
"""
import os
import sys

import requests

H = {"X-Api-Key": os.environ["HEYGEN_API_KEY"]}


def get(path):
    r = requests.get(f"https://api.heygen.com{path}", headers=H, timeout=30)
    r.raise_for_status()
    return r.json().get("data") or {}


d = get("/v2/avatars")
print("PHOTO AVATARS  (HEYGEN_AVATAR_TYPE=talking_photo)")
for t in d.get("talking_photos") or []:
    print(f"  {t.get('talking_photo_id')}  {t.get('talking_photo_name', '')}")
print("\nVIDEO AVATARS  (HEYGEN_AVATAR_TYPE=avatar)  — your own first, then a few stock ones")
avs = d.get("avatars") or []
for a in avs[:15]:
    print(f"  {a.get('avatar_id')}  {a.get('avatar_name', '')}")
if len(avs) > 15:
    print(f"  ... {len(avs) - 15} more")

v = get("/v2/voices")
voices = v.get("voices") or []
if "--all-voices" not in sys.argv:
    voices = [x for x in voices if str(x.get("language", "")).lower().startswith("english")]
print(f"\nVOICES ({len(voices)})  — HEYGEN_VOICE_ID")
for x in voices:
    print(f"  {x.get('voice_id')}  {x.get('name', '')}  {x.get('gender', '')}  {x.get('language', '')}")
