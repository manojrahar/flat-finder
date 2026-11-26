"""Find each Jaipur society's Rajasthan RERA (RajRERA) filing and OCR its brochure / building plan documents.

usage: python rajrera.py jaipur [limit]
       -> data/verified/<city>-rera.json

RajRERA APIs are public and load without login or CAPTCHA. Requests are throttled politely and cached;
PDFs are read with the local brochure OCR pipeline and deleted afterwards.
"""
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

import brochure_ocr
from build_city import tokens

ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache" / "rajrera"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
LIST_API = "https://reraapi.rajasthan.gov.in/api/web/Home/GetProjects"
DETAIL_API = "https://reraapp.rajasthan.gov.in/HomeWebsite/ProjectDtlsWebsite/{}"
API_KEY = "MySuperSecretApiKey_123"
DOC_BASE = "https://reraapp.rajasthan.gov.in/"
JAIPUR_DISTRICT_ID = 1077

WANT = re.compile(
    r"BROCHURE|APARTMENT\s*PLAN|UNIT\s*PLAN|FLOOR\s*PLAN|TYPICAL\s*FLOOR|DWELLING\s*UNIT|"
    r"AREA\s*DIAGRAM|APPROVED\s*BUILDING\s*PLAN|BUILDING\s*PLAN|APPROVAL\s*DOCUMENTS|"
    r"MAP|DRAWING|LAYOUT",
    re.I,
)
SKIP = re.compile(
    r"ADVOCATE|SEARCH\s*REPORT|TITLE|CHAIN\s*OF\s*LAND|FORM\s*[ABG]|AFFIDAVIT|MILESTONE|GANTT|"
    r"NOC|ITR|BALANCE\s*SHEET|BANK|CERTIFICATE|AGREEMENT|LITIGATION|CRIMINAL|AUTHORIZATION|"
    r"RESOLUTION|RECEIPT|CHECKLIST|ALLOTMENT|ZONING|DEMARCATION|GOOGLE\s*MAP|KML|KMZ|CESS",
    re.I,
)


def _curl_json(url, post_body=None, headers=(), cache_name=None):
    if cache_name:
        f = CACHE / cache_name
        if f.exists():
            return json.loads(f.read_text())
    cmd = ["curl", "-sL", "-A", UA, "--max-time", "60"]
    for h in headers:
        cmd += ["-H", h]
    if post_body is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(post_body)]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"curl failed ({r.returncode}) for {url}")
    raw = r.stdout.decode("utf-8", "ignore")
    data = json.loads(raw)
    time.sleep(0.5)
    if cache_name:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / cache_name).write_text(raw)
    return data


def registered_projects(district_id=JAIPUR_DISTRICT_ID):
    payload = {
        "DistrictId": district_id, "TeshilId": 0, "ProjectName": "",
        "PromoterName": "", "RegistrationNo": "", "ProjectType": 0,
        "ApplicationStatus": 0, "Year": 0,
    }
    res = _curl_json(
        LIST_API, post_body=payload,
        headers=[f"X-API-KEY: {API_KEY}"],
        cache_name=f"projects_{district_id}.json",
    )
    return res.get("Data") or []


def norm_reg(t):
    return re.sub(r"[^0-9A-Z/]", "", (t or "").upper().split("(")[0])


def match(society, projects):
    rid = norm_reg(society.get("rera_id"))
    if rid and len(rid) >= 6:
        for p in projects:
            prid = norm_reg(p.get("REGISTRATIONNO"))
            if not prid:
                continue
            for part in re.split(r",|\s+AND\s+|\s+", society["rera_id"].upper()):
                r = norm_reg(part)
                if len(r) >= 6 and (r == prid or r in prid or prid in r):
                    return p
    want = tokens(society["name"])
    if not want or len(want) < 2:
        return None
    best = None
    for p in projects:
        have = tokens(p.get("ProjectName"))
        if want <= have:
            if best is None or len(have) < len(tokens(best.get("ProjectName"))):
                best = p
    return best


def _doc_url(rel):
    if not rel:
        return None
    rel = rel.strip().replace("\\", "/")
    if rel.startswith("../"):
        rel = rel[3:]
    elif rel.startswith("~/"):
        rel = rel[2:]
    elif rel.startswith("/"):
        rel = rel[1:]
    url = rel if rel.startswith("http") else DOC_BASE + rel
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, urllib.parse.quote(parts.path, safe="/+"), parts.query, ""))


def documents(enc_id):
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", enc_id)
    res = _curl_json(DETAIL_API.format(urllib.parse.quote(enc_id, safe="")), cache_name=f"proj_{safe}.json")
    data = res.get("data") or {}
    docs, seen = [], set()
    for item in data.get("GetDocumentsList") or []:
        label = f"{item.get('ApplicationDocumentName') or ''} {item.get('DocumentName') or ''}".strip()
        if not WANT.search(label) or SKIP.search(label):
            continue
        urls = [item.get("DocumentUrl")] + [
            sub.get("DocumentUrl") for sub in (item.get("DocLstForMultipleUpdationsFromSpecialMod") or [])
        ]
        for rel in urls:
            u = _doc_url(rel)
            if u and u.lower().split("?")[0].endswith(".pdf") and u not in seen:
                seen.add(u)
                docs.append({"name": (item.get("ApplicationDocumentName") or item.get("DocumentName") or "RERA Document").strip(), "url": u})
    return docs, data.get("ProjectLocation")


def run(job):
    sid, d = job
    _, r = brochure_ocr.read_brochure((sid, d["url"]))
    return sid, d["name"], d["url"], r


def main(city="jaipur", limit=None):
    data = json.loads((ROOT.parent / "web" / "public" / "data" / f"{city}.json").read_text())
    out_file = ROOT.parent / "data" / "verified" / f"{city}-rera.json"
    done = json.loads(out_file.read_text())["societies"] if out_file.exists() else {}
    projects = registered_projects()
    print("RajRERA Jaipur projects", len(projects), flush=True)

    def has_rooms(s):
        return any(u.get("bedrooms") or u.get("ai") for u in s["unit_types"])

    pool = [
        s for s in data["societies"]
        if s["kind"] in ("apartment", "builder floor")
        and not s["verified"]
        and not has_rooms(s)
        and s["id"] not in done
    ]
    pool.sort(key=lambda s: (not s.get("rera_id"), -((s.get("sale_count") or 0) + (s.get("rent_count") or 0))))
    if limit:
        pool = pool[:limit]
    jobs = []
    matched = []
    for s in pool:
        p = match(s, projects)
        if not p or not p.get("EncryptedProjectId"):
            done[s["id"]] = {"status": "no RERA match"}
            continue
        matched.append((s, p))

    def fetch_docs(pair):
        s, p = pair
        try:
            docs, loc = documents(p["EncryptedProjectId"])
            return s, p, docs, loc, None
        except Exception as e:
            return s, p, [], None, str(e)[:120]

    with ThreadPoolExecutor(max_workers=6) as tex:
        for s, p, docs, loc, err in tex.map(fetch_docs, matched):
            if err:
                done[s["id"]] = {"status": "page error", "project": "https://rera.rajasthan.gov.in/", "error": err}
                continue
            reg = p.get("REGISTRATIONNO")
            proj_url = f"https://reraapp.rajasthan.gov.in/HomeWebsite/ProjectDtlsWebsite/{urllib.parse.quote(p['EncryptedProjectId'], safe='')}"
            done[s["id"]] = {
                "status": "matched",
                "rera_no": reg,
                "project": proj_url,
                "hrera_name": p.get("ProjectName"),
                "location": loc,
                "docs": [d["name"] for d in docs],
            }
            jobs += [(s["id"], d) for d in docs[:3]]
    print("matched", sum(1 for v in done.values() if v.get("rera_no")), "documents to read", len(jobs), flush=True)

    with ProcessPoolExecutor(max_workers=4) as ex:
        for i, (sid, name, doc_url, r) in enumerate(ex.map(run, jobs), 1):
            done[sid].setdefault("read", []).append({"doc": name, "url": doc_url, "status": r["status"], "pages": r.get("pages", [])})
            if i % 10 == 0 or i == len(jobs):
                print(f"{i}/{len(jobs)} documents", flush=True)
                out_file.write_text(json.dumps({"societies": done}, indent=0))
    out_file.write_text(json.dumps({"societies": done}, indent=0))
    from collections import Counter
    print(Counter(v["status"] for v in done.values()))
    print("societies with rooms read from RajRERA", sum(1 for v in done.values() if any(x.get("pages") for x in v.get("read", []))))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "jaipur", int(sys.argv[2]) if len(sys.argv) > 2 else None)
