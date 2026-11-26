"""Polite, cached, resumable Magicbricks crawler.

usage: python mb_crawl.py list <city>      # all list pages -> out/<city>/mb_index.json
       python mb_crawl.py projects <city>  # every project page -> out/<city>/mb_projects.json
<city> is a key in data/cities.json (default gurgaon).
"""
import gzip
import hashlib
import http.cookiejar
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import mb_parse

ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache" / "mb"
OUT = ROOT / "out"
CITIES = json.loads((ROOT.parent / "data" / "cities.json").read_text())
CITY = next((a for a in sys.argv[1:] if a in CITIES), "gurgaon")
CFG = CITIES[CITY]
LIST_URL = "https://www.magicbricks.com/residential-projects-in-" + CFG["magicbricks"] + "-nprid/page-{}"
API_URL = "https://www.magicbricks.com/mbproject/newProjectCards?&pageNo={}&city={}&possessionCheck=N"
REFERRER_URL = "https://www.magicbricks.com/under-construction-projects-in-" + CFG["magicbricks"] + "-nprid"
OUT = OUT / CITY
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
DELAY = 0.15
_OPENER = None


def _is_bad_html(text):
    return "We'll be back soon!" in text or "Oops... Something is missing" in text


def fetch(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html.gz")
    if f.exists() and f.stat().st_size > 2000:
        cached = gzip.decompress(f.read_bytes()).decode("utf-8", "ignore")
        if not _is_bad_html(cached):
            return cached
    for attempt in range(4):
        try:
            parts = urllib.parse.urlsplit(url)
            safe_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, urllib.parse.quote(parts.path, safe="/%"), parts.query, parts.fragment))
            req = urllib.request.Request(safe_url, headers={"User-Agent": UA})
            html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
            if _is_bad_html(html):
                raise RuntimeError("maintenance or 404 page returned")
            f.write_bytes(gzip.compress(html.encode("utf-8"), 9))
            time.sleep(DELAY)
            return html
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            print("  retry", attempt + 1, url, e, flush=True)
            time.sleep(4 * (attempt + 1))
        except Exception as e:  # network hiccup: back off and retry
            print("  retry", attempt + 1, url, e, flush=True)
            time.sleep(4 * (attempt + 1))
    return None


def _api_opener():
    global _OPENER
    if _OPENER is not None:
        return _OPENER
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    for seed in (REFERRER_URL, "https://www.magicbricks.com/residential-projects-in-" + CFG["magicbricks"] + "-nprid", "https://www.magicbricks.com/"):
        try:
            op.open(urllib.request.Request(seed, headers={"User-Agent": UA}), timeout=25).read()
            break
        except Exception:
            continue
    _OPENER = op
    return op


def fetch_api_page(city_id, page_no):
    url = API_URL.format(page_no, city_id)
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json.gz")
    if f.exists() and f.stat().st_size > 200:
        return json.loads(gzip.decompress(f.read_bytes()).decode("utf-8", "ignore"))
    for attempt in range(4):
        try:
            op = _api_opener()
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json, text/plain, */*",
                "Referer": REFERRER_URL,
                "X-Requested-With": "XMLHttpRequest",
            })
            raw = op.open(req, timeout=30).read().decode("utf-8", "ignore")
            data = json.loads(raw)
            f.write_bytes(gzip.compress(raw.encode("utf-8"), 9))
            time.sleep(DELAY)
            return data
        except Exception as e:
            global _OPENER
            _OPENER = None
            print("  api retry", attempt + 1, page_no, e, flush=True)
            time.sleep(4 * (attempt + 1))
    return None


def crawl_list():
    projects = {}
    total = None
    first = fetch(LIST_URL.format(1))
    if first:
        total = mb_parse.parse_total(first)
    if total:
        pages = -(-total // 20)
        for n in range(1, pages + 1):
            html = first if n == 1 else fetch(LIST_URL.format(n))
            if not html:
                continue
            for c in mb_parse.parse_list_page(html):
                projects[c["psmid"]] = mb_parse.card_to_project(c)
            if n % 10 == 0 or n == pages:
                print(f"list {n}/{pages}: {len(projects)} projects", flush=True)
    elif CFG.get("mb_city_id"):
        cid = CFG["mb_city_id"]
        d1 = fetch_api_page(cid, 1)
        if not d1 or not d1.get("projectsCards"):
            raise SystemExit(f"Could not fetch Magicbricks API list for city {CITY} ({cid})")
        total = d1.get("totalCount") or 0
        pages = d1.get("pageCount") or (-(-total // 20))
        for n in range(1, pages + 1):
            d = d1 if n == 1 else fetch_api_page(cid, n)
            if not d:
                continue
            for c in d.get("projectsCards") or []:
                projects[c["psmid"]] = mb_parse.card_to_project(c)
            if n % 10 == 0 or n == pages:
                print(f"api list {n}/{pages}: {len(projects)} projects", flush=True)
    else:
        raise SystemExit(f"No list endpoint available for {CITY}; set mb_city_id in data/cities.json")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "mb_index.json").write_text(json.dumps(list(projects.values()), indent=0))
    print("total reported", total, "collected", len(projects))


def crawl_projects(limit=None):
    index = json.loads((OUT / "mb_index.json").read_text())
    if limit:
        index = index[:limit]
    from concurrent.futures import ThreadPoolExecutor

    def one(p):
        html = fetch(p["url"])
        try:
            detail = mb_parse.parse_project_page(html) if html else {}
        except Exception as e:
            print("  parse failed", p["url"], e, flush=True)
            detail = {}
        return {**p, **{k: v for k, v in detail.items() if v not in (None, [], "")}}

    out = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, merged in enumerate(ex.map(one, index), 1):
            out.append(merged)
            if i % 100 == 0 or i == len(index):
                print(f"project {i}/{len(index)}", flush=True)
                (OUT / "mb_projects.json").write_text(json.dumps(out, indent=0))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "list":
        crawl_list()
    elif cmd == "projects":
        lim = next((int(a) for a in sys.argv[2:] if a.isdigit()), None)
        crawl_projects(lim)
    else:
        raise SystemExit(f"unknown command {cmd}")
