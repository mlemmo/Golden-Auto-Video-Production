"""Load inventory from either the scraped inventory.json or the DealerCenter XML export
and normalize it into Vehicle records the rest of the pipeline uses.

The XML mapping below is a best guess at DealerCenter's tag names. When the real export
arrives, run `python feed.py your_export.xml` — it prints which fields matched — and add any
missing tag names to FIELD_ALIASES.
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, asdict
from pathlib import Path

CDN_RE = re.compile(r"https?://imagescf\.dealercenter\.net/\d+/\d+/([^/?#]+?)\.jpg", re.I)


@dataclass
class Vehicle:
    stock: str
    vin: str
    year: int
    make: str
    model: str
    trim: str = ""
    body: str = ""
    fuel: str = ""
    drivetrain: str = ""
    transmission: str = ""
    engine: str = ""
    mileage: int | None = None
    exterior_color: str = ""
    interior_color: str = ""
    price_advertised: float | None = None   # the price the ad shows (fee-inclusive on the website)
    price_base: float | None = None
    description: str = ""
    url: str = ""
    photos: list[str] = field(default_factory=list)

    @property
    def title(self) -> str:
        return f"{self.year} {nice_case(self.make)} {nice_case(self.model)}"

    @property
    def key(self) -> str:
        return self.vin or f"stock:{self.stock}"

    def facts(self) -> dict:
        """Only the fields the script writer is allowed to mention."""
        d = asdict(self)
        d.pop("photos")
        d["title"] = self.title
        return {k: v for k, v in d.items() if v not in (None, "", [])}


def nice_case(s: str) -> str:
    """Inventory ALL-CAPS to display case, keeping codes: XV, CR-V, XC90, BMW, 4Runner."""
    out = []
    for w in s.split():
        if (len(w) <= 3 and not set(w.lower()) & set("aeiou")) or "-" in w or (any(c.isdigit() for c in w) and not w[0].isdigit()):
            out.append(w.upper())
        elif w[0].isdigit():
            i = next((k for k, c in enumerate(w) if c.isalpha()), len(w))
            out.append(w[:i] + w[i:].capitalize())
        else:
            out.append(w.capitalize())
    return " ".join(out)


def hi_res(url: str, w: int = 1920, h: int = 1080) -> str:
    """Rewrite any DealerCenter CDN size to the size we want."""
    m = CDN_RE.match(url.strip())
    return f"https://imagescf.dealercenter.net/{w}/{h}/{m.group(1)}.jpg" if m else url.strip()


def _num(v):
    if v in (None, ""):
        return None
    s = re.sub(r"[^0-9.]", "", str(v))
    return float(s) if s else None


# ---------------------------------------------------------------- JSON (scraper)
def load_json(path: Path) -> list[Vehicle]:
    data = json.loads(path.read_text())
    out = []
    for v in data["vehicles"]:
        v["photos"] = [hi_res(p) for p in v.get("photos", [])]
        v["mileage"] = int(v["mileage"]) if v.get("mileage") else None
        out.append(Vehicle(**{k: v.get(k) for k in Vehicle.__dataclass_fields__ if k in v}))
    return out


# ---------------------------------------------------------------- XML (DealerCenter export)
FIELD_ALIASES = {
    "stock": ["stocknumber", "stock", "stockno", "stock_number"],
    "vin": ["vin"],
    "year": ["year", "modelyear"],
    "make": ["make"],
    "model": ["model"],
    "trim": ["trim", "series", "style"],
    "body": ["bodystyle", "body", "bodytype"],
    "fuel": ["fueltype", "fuel"],
    "drivetrain": ["drivetrain", "drivetype", "drive"],
    "transmission": ["transmission"],
    "engine": ["engine", "enginedescription"],
    "mileage": ["mileage", "odometer", "miles"],
    "exterior_color": ["exteriorcolor", "extcolor", "color"],
    "interior_color": ["interiorcolor", "intcolor"],
    "price_advertised": ["internetprice", "sellingprice", "specialprice", "price", "retailprice"],
    "description": ["comments", "description", "sellernotes", "notes"],
    "url": ["vdpurl", "url", "link", "detailurl"],
}
PHOTO_TAGS = ["imageurls", "images", "photos", "photourls", "imagelist", "image", "photo", "imageurl", "photourl"]
VEHICLE_TAGS = ["vehicle", "car", "listing", "item", "unit", "inventory_item"]


def _local(tag: str) -> str:
    return tag.split("}")[-1].lower().replace("_", "").replace("-", "")


def _children(el) -> dict[str, ET.Element]:
    return {_local(c.tag): c for c in el}


def load_xml(path: Path, report: bool = False) -> list[Vehicle]:
    root = ET.parse(path).getroot()
    nodes = [e for e in root.iter() if _local(e.tag) in VEHICLE_TAGS and len(e)] or list(root)
    out, matched = [], set()
    for node in nodes:
        kids = _children(node)
        rec = {}
        for fname, aliases in FIELD_ALIASES.items():
            for a in aliases:
                a = a.replace("_", "")
                if a in kids and (kids[a].text or "").strip():
                    rec[fname] = kids[a].text.strip()
                    matched.add(fname)
                    break
        photos: list[str] = []
        for t in PHOTO_TAGS:
            for el in node.iter():
                if _local(el.tag) == t:
                    txt = (el.text or "").strip()
                    if txt:
                        photos += [p for p in re.split(r"[|,\s]+", txt) if p.startswith("http")]
        rec["photos"] = list(dict.fromkeys(hi_res(p) for p in photos))
        rec["year"] = int(_num(rec.get("year")) or 0)
        rec["mileage"] = int(_num(rec.get("mileage")) or 0) or None
        rec["price_advertised"] = _num(rec.get("price_advertised"))
        rec.setdefault("stock", rec.get("vin", "")[-6:])
        if rec.get("vin") and rec.get("make"):
            out.append(Vehicle(**rec))
    if report:
        missing = sorted(set(FIELD_ALIASES) - matched)
        print(f"{len(out)} vehicles. Matched fields: {sorted(matched)}")
        print(f"Unmatched (add tag names to FIELD_ALIASES): {missing}")
        print(f"Vehicles with no photos: {sum(1 for v in out if not v.photos)}")
    return out


# ---------------------------------------------------------------- existing dashboard app (SQLite)
def load_app_db(path: Path) -> list[Vehicle]:
    """Active vehicles from the Golden Auto dashboard's inventory (kept current by its DealerCenter sync).

    Photos are the app's own overlay-free copies; `sheet_photos` (front, side, side, rear picks) go first.
    """
    import sqlite3
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    row = con.execute("SELECT payload FROM state WHERE id='inventory'").fetchone()
    con.close()
    out = []
    for r in (json.loads(row[0])["vehicles"] if row else []):
        if r.get("active", True) is False or not r.get("price"):
            continue
        photos = list(r.get("photos") or [])
        picks = [photos[i - 1] for i in (r.get("sheet_photos") or []) if 0 < i <= len(photos)]
        photos = picks + [p for p in photos if p not in picks]
        vin = r.get("Vin") or ""
        out.append(Vehicle(
            stock=r["StockNumber"], vin="" if vin.startswith("stock:") else vin,
            year=int(r["Year"]), make=r["Make"], model=r["Model"], trim=r.get("Trim", ""),
            drivetrain=r.get("Drivetrain", ""), exterior_color=r.get("ExteriorColor", "") or r.get("color", ""),
            mileage=r.get("Odometer"), price_advertised=float(r["price"]),   # app rule: highest advertised price
            description=r.get("description", ""), url=r.get("url", ""), photos=photos))
    return out


def load_inventory(path: str | Path) -> list[Vehicle]:
    p = Path(path)
    suffix = p.suffix.lower()
    if suffix == ".xml":
        return load_xml(p)
    if suffix in (".sqlite", ".db"):
        return load_app_db(p)
    return load_json(p)


if __name__ == "__main__":
    p = Path(sys.argv[1] if len(sys.argv) > 1 else "inventory.json")
    vs = load_xml(p, report=True) if p.suffix.lower() == ".xml" else load_inventory(p)
    for v in vs:
        print(f"{v.stock:>8}  {v.title:<32} {v.mileage or '':>8} mi  ${v.price_advertised or 0:,.2f}  {len(v.photos)} photos")
