"""List the HeyGen photo avatars, video avatars and voices on your account, with the IDs .env needs.

  set -a; source /opt/goldenauto-video/.env; set +a
  /opt/goldenauto-video/venv/bin/python /opt/goldenauto-video/heygen_ids.py [--all-voices]

HeyGen's full avatar list includes its whole stock library and can take a minute or two.
"""
import os
import sys
import time

import requests

H = {"X-Api-Key": os.environ["HEYGEN_API_KEY"]}


def get(path, timeout=180):
    for attempt in (1, 2):
        try:
            r = requests.get(f"https://api.heygen.com{path}", headers=H, timeout=(15, timeout))
            r.raise_for_status()
            return r.json().get("data") or {}
        except requests.Timeout:
            if attempt == 2:
                raise
            print(f"  ({path} is slow, retrying...)", flush=True)
            time.sleep(5)


# 1. Your photo avatars (small, fast list)
print("PHOTO AVATARS  (HEYGEN_AVATAR_TYPE=talking_photo)", flush=True)
try:
    photos = get("/v1/talking_photo.list", timeout=60)
    photos = photos if isinstance(photos, list) else photos.get("talking_photos", [])
except Exception as e:                      # older/newer accounts: fall back to the full list below
    print(f"  (quick list unavailable: {e})")
    photos = None
if photos is not None:
    for t in photos:
        print(f"  {t.get('id') or t.get('talking_photo_id')}  {t.get('name') or t.get('talking_photo_name', '')}")

# 2. Voices
v = get("/v2/voices")
voices = v.get("voices") or []
if "--all-voices" not in sys.argv:
    voices = [x for x in voices if str(x.get("language", "")).lower().startswith("english")]
print(f"\nVOICES ({len(voices)})  — HEYGEN_VOICE_ID", flush=True)
for x in voices:
    print(f"  {x.get('voice_id')}  {x.get('name', '')}  {x.get('gender', '')}  {x.get('language', '')}")

# 3. Full avatar list (slow) — only if asked, or if the quick photo list failed
if photos is None or "--video-avatars" in sys.argv:
    print("\nLoading full avatar list (can take a minute or two)...", flush=True)
    d = get("/v2/avatars", timeout=300)
    if photos is None:
        print("PHOTO AVATARS")
        for t in d.get("talking_photos") or []:
            print(f"  {t.get('talking_photo_id')}  {t.get('talking_photo_name', '')}")
    print("VIDEO AVATARS  (HEYGEN_AVATAR_TYPE=avatar)")
    for a in d.get("avatars") or []:
        print(f"  {a.get('avatar_id')}  {a.get('avatar_name', '')}")
