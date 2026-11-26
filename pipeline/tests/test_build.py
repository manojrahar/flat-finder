import build_city
import geo


def area(name, center, r=150):
    return {"type": "Feature", "properties": {"osm": "way/" + name, "name": name},
            "geometry": {"type": "Polygon", "coordinates": [geo.circle(center, r)]}}


def test_match_area_inside_and_by_name():
    areas = [area("Heritage One", (77.0891, 28.4027)), area("Skyon", (77.0966, 28.3995))]
    g = build_city.Grid(areas, lambda a: geo.centroid(a["geometry"]["coordinates"][0]))
    p = {"name": "Conscient Heritage One", "lng": 77.0893, "lat": 28.4030}
    assert build_city.match_area(p, g)["properties"]["name"] == "Heritage One"
    near = {"name": "Ireo Skyon", "lng": 77.0966 + 0.0025, "lat": 28.3995}  # ~245 m east, outside
    assert build_city.match_area(near, g)["properties"]["name"] == "Skyon"
    far = {"name": "Random Homes", "lng": 77.2, "lat": 28.5}
    assert build_city.match_area(far, g) is None


def test_dedupe_merges_phases_close_by():
    a = {"name": "Heritage One", "lng": 77.0890, "lat": 28.4034, "url": "a"}
    b = {"name": "Heritage One", "lng": 77.0891, "lat": 28.4021, "url": "b"}
    c = {"name": "Heritage One", "lng": 77.2, "lat": 28.5, "url": "c"}
    out = build_city.dedupe([a, b, c])
    assert len(out) == 2 and out[0]["merged"] == ["b"]


def test_kind_of():
    assert build_city.kind_of({"config_text": "2, 3, 4 BHK Multistorey Apartments"}) == "apartment"
    assert build_city.kind_of({"config_text": "Residential Plot"}) == "plot"
    assert build_city.kind_of({"config_text": "4 BHK Villa"}) == "villa"
    assert build_city.kind_of({"config_text": "Commercial Office Spaces"}) == "commercial"
    assert build_city.kind_of({"config_text": "Commercial Shops"}) == "commercial"


def test_neighbourhood_sized_area_is_not_a_society_site():
    big = area("DLF Phase 4", (77.08, 28.46), r=700)  # ~1.5 km2
    g = build_city.Grid([big], lambda a: geo.centroid(a["geometry"]["coordinates"][0]))
    p = {"name": "Some Apartments", "lng": 77.08, "lat": 28.46, "acres": 5}
    assert build_city.match_area(p, g) is None


def test_kind_from_unit_codes_when_text_missing():
    assert build_city.kind_of({"configs": {"units": [{"kind": "10000"}]}}) == "plot"
    assert build_city.kind_of({"configs": {"units": [{"kind": "10008"}, {"kind": "10002"}]}}) == "apartment"
    assert build_city.kind_of({}) == "apartment~"


def test_kind_from_card_type_codes():
    assert build_city.kind_of({"type_codes": ["10000"]}) == "plot"
    assert build_city.kind_of({"card_units": [{"kind": "10003", "bhk": 3, "sqft": 1900.0}]}) == "builder floor"


def test_infer_kind_from_name():
    assert build_city.kind_of({"name": "Sai Ram Apartment"}) == "apartment~"
    assert build_city.kind_of({"name": "Rzone Land Plot"}) == "plot~"
    assert build_city.kind_of({"name": "Emaar Business District 114"}) == "commercial~"
    assert build_city.kind_of({"name": "Ashiana Villas"}) == "villa~"


def test_match_verified_needs_whole_name_and_sector():
    ps = [{"mb_id": 1, "name": "M3M", "locality": "Sector 65"},
          {"mb_id": 2, "name": "M3M Heights", "locality": "Sector 65"},
          {"mb_id": 3, "name": "M3M St Andrews at SCDA", "locality": "Sector 113"},
          {"mb_id": 4, "name": "M3M St. Andrews", "locality": "Sector 65"}]
    assert build_city.match_verified({"match": ["M3M Heights"], "sector": "65"}, ps)["mb_id"] == 2
    assert build_city.match_verified({"match": ["M3M St Andrews"], "sector": "65"}, ps)["mb_id"] == 4
    assert build_city.match_verified({"match": ["M3M Heights"], "sector": "65"}, ps, taken={2}) is None


def test_in_bbox_city_agnostic():
    jaipur_bbox = [26.68, 75.55, 27.10, 76.00]
    assert build_city.in_bbox({"lat": 26.9064, "lng": 75.7360}, jaipur_bbox) is True
    assert build_city.in_bbox({"lat": 28.4169, "lng": 76.9096}, jaipur_bbox) is False
    assert build_city.in_bbox({"lat": None, "lng": 75.7360}, jaipur_bbox) is False
    assert build_city.normalize_coords({"lat": 75.689, "lng": 26.910}, jaipur_bbox)["lat"] == 26.910
    assert build_city.normalize_coords({"lat": 28.4169, "lng": 76.9096}, jaipur_bbox) is None
    assert "jaipur" not in build_city.tokens("The Crest Jaipur")


def test_build_context_features_simplifies_and_dedupes():
    pts = [[75.7000, 26.8000], [75.7050, 26.80001], [75.7100, 26.8000]]
    simp = build_city.simplify_line(pts)
    assert len(simp) == 2
    cfg = {"name": "Jaipur"}
    ctx = {"ways": [{"kind": "road", "cls": "trunk", "name": "Tonk Road", "pts": pts}],
           "places": [{"name": "Vaishali Nagar", "cls": "suburb", "lng": 75.736, "lat": 26.906}]}
    socs = [{"locality": "Vaishali Nagar", "lng": 75.736, "lat": 26.906} for _ in range(5)] + [
        {"locality": "Jagatpura", "lng": 75.835, "lat": 26.828} for _ in range(4)]
    pois = [{"k": "metro", "name": "Mansarovar Metro", "lng": 75.75, "lat": 26.879},
            {"k": "park", "name": "Park", "lng": 75.76, "lat": 26.88}]  # generic "Park" skipped
    feats = build_city.build_context_features("jaipur", cfg, socs, ctx, pois)
    areas = [f["properties"]["name"] for f in feats if f["properties"]["fk"] == "area"]
    poi_names = [f["properties"]["name"] for f in feats if f["properties"]["fk"] == "poi"]
    assert "Vaishali Nagar" in areas and areas.count("Vaishali Nagar") == 1
    assert "Jagatpura" in areas
    assert poi_names == ["Mansarovar Metro"]
