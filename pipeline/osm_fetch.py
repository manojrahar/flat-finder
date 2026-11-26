"""Fetch residential areas and building footprints for a city bbox from Overpass, once.

usage: python osm_fetch.py <city>  -> out/<city>/osm_areas.geojson, out/<city>/osm_buildings.geojson
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache" / "osm"
OUT = ROOT / "out"
CITIES = json.loads((ROOT.parent / "data" / "cities.json").read_text())
CITY = next((a for a in sys.argv[1:] if a in CITIES), "gurgaon")
BBOX = tuple(CITIES[CITY]["bbox"])  # south, west, north, east
OUT = OUT / CITY
CACHE = CACHE / CITY
MIRRORS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def overpass(query, name):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{name}.json"
    if f.exists():
        return json.loads(f.read_text())
    body = urllib.parse.urlencode({"data": query}).encode()
    for url in MIRRORS * 2:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "flat-finder/0.1"})
            raw = urllib.request.urlopen(req, timeout=300).read()
            data = json.loads(raw)
            f.write_bytes(raw)
            return data
        except Exception as e:
            # curl uses the macOS trust store (mirrors like maps.mail.ru fail Python's OpenSSL chain)
            try:
                r = subprocess.run(
                    ["curl", "-sfL", "-A", "flat-finder/0.1", "--max-time", "300", "--data-urlencode", f"data={query}", url],
                    capture_output=True,
                )
                if r.returncode == 0 and r.stdout:
                    data = json.loads(r.stdout)
                    f.write_bytes(r.stdout)
                    return data
            except Exception:
                pass
            print("mirror failed", url, e, flush=True)
            time.sleep(10)
    raise SystemExit("all Overpass mirrors failed")


def _pts(geom):
    return [(round(p["lon"], 6), round(p["lat"], 6)) for p in geom]


def ring_from_relation(el):
    """Join a multipolygon relation's outer member ways into closed rings."""
    segs = [_pts(m["geometry"]) for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def height_of(tags):
    try:
        if tags.get("height"):
            return float(str(tags["height"]).split()[0])
        if tags.get("building:levels"):
            return float(tags["building:levels"]) * 3.2
    except ValueError:
        pass
    return None


def main():
    s, w, n, e = BBOX
    bb = f"({s},{w},{n},{e})"
    areas = overpass(f'[out:json][timeout:280];(way["landuse"="residential"]["name"]{bb};relation["landuse"="residential"]["name"]{bb};);out geom;', "areas")
    feats = []
    for el in areas["elements"]:
        rings = ring_from_relation(el) if el["type"] == "relation" else [_pts(el["geometry"])]
        for r in rings:
            feats.append({"type": "Feature", "properties": {"osm": f"{el['type']}/{el['id']}", "name": el["tags"]["name"]},
                          "geometry": {"type": "Polygon", "coordinates": [r]}})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_areas.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print("areas", len(feats))

    blds = overpass(f'[out:json][timeout:280];way["building"]{bb};out geom;', "buildings")
    bf = []
    for el in blds["elements"]:
        if "geometry" not in el:
            continue
        r = _pts(el["geometry"])
        if r[0] != r[-1]:
            r.append(r[0])
        bf.append({"type": "Feature", "properties": {"osm": el["id"], "h": height_of(el.get("tags", {}))},
                   "geometry": {"type": "Polygon", "coordinates": [r]}})
    (OUT / "osm_buildings.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": bf}))
    print("buildings", len(bf))


POI_QUERY = """[out:json][timeout:280];(
  way["leisure"="park"]{bb};relation["leisure"="park"]{bb};node["leisure"="park"]{bb};
  node["railway"="station"]{bb};node["station"="subway"]{bb};node["railway"="halt"]{bb};
  node["amenity"="school"]{bb};way["amenity"="school"]{bb};
  node["amenity"="hospital"]{bb};way["amenity"="hospital"]{bb};
  node["shop"="mall"]{bb};way["shop"="mall"]{bb};way["shop"="supermarket"]{bb};node["shop"="supermarket"]{bb};
);out center tags;"""


CONTEXT_QUERY = """[out:json][timeout:120];(
  way["highway"~"^(motorway|trunk|primary|secondary)$"]{bb};
  way["highway"="tertiary"]["name"]{bb};
  way["railway"~"^(subway|light_rail|rail)$"]{bb};
  node["place"~"^(city|town|suburb|quarter|neighbourhood|locality)$"]["name"]{bb};
);out body geom qt;"""


def poi_kind(t):
    if t.get("leisure") == "park":
        return "park"
    if t.get("amenity") in ("school", "hospital"):
        return t["amenity"]
    if t.get("shop") in ("mall", "supermarket"):
        return "shopping"
    if t.get("station") == "subway" or t.get("subway") == "yes" or (
        t.get("railway") in ("station", "halt", "subway_entrance") and "metro" in (t.get("name") or "").lower()
    ):
        return "metro"
    if t.get("railway") in ("station", "halt"):
        return "rail"
    return None


def fetch_pois():
    s, w, n, e = BBOX
    data = overpass(POI_QUERY.replace("{bb}", f"({s},{w},{n},{e})"), "pois")
    out = []
    for el in data["elements"]:
        c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        k = poi_kind(el.get("tags", {}))
        if c and k:
            out.append({"k": k, "name": el.get("tags", {}).get("name"), "lng": round(c["lon"], 5), "lat": round(c["lat"], 5)})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_pois.json").write_text(json.dumps(out))
    from collections import Counter
    print("pois", Counter(p["k"] for p in out))


def fetch_context():
    """Fetch major roads, rail/metro lines, and named places for always-on map context."""
    s, w, n, e = BBOX
    data = overpass(CONTEXT_QUERY.replace("{bb}", f"({s},{w},{n},{e})"), "context")
    ways, places = [], []
    for el in data["elements"]:
        t = el.get("tags", {})
        if el["type"] == "node" and t.get("place"):
            name = t.get("name:en") or t.get("name")
            if name:
                places.append({"name": name, "cls": t["place"], "lng": round(el["lon"], 5), "lat": round(el["lat"], 5)})
        elif el["type"] == "way" and el.get("geometry"):
            pts = [[round(p["lon"], 5), round(p["lat"], 5)] for p in el["geometry"]]
            if len(pts) < 2:
                continue
            name = t.get("name:en") or t.get("name") or t.get("ref") or ""
            if t.get("highway"):
                ways.append({"kind": "road", "cls": t["highway"], "name": name, "pts": pts})
            elif t.get("railway"):
                ways.append({"kind": "rail", "cls": t["railway"], "name": name, "pts": pts})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_context.json").write_text(json.dumps({"ways": ways, "places": places}))
    print("context", CITY, "ways", len(ways), "places", len(places))


if __name__ == "__main__":
    if "pois" in sys.argv:
        fetch_pois()
    elif "context" in sys.argv:
        fetch_context()
    else:
        main()
        fetch_pois()
        fetch_context()
