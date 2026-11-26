import rajrera


def test_match_by_rera_id_and_name():
    projects = [
        {"ProjectName": "Vardhman Eminara (Phase I)", "REGISTRATIONNO": "RAJ/P/2024/3341", "EncryptedProjectId": "abc"},
        {"ProjectName": "Purple Melodia", "REGISTRATIONNO": "RAJ/P/2018/700", "EncryptedProjectId": "def"},
    ]
    assert rajrera.match({"name": "Vardhman Eminara", "rera_id": "RAJ/P/2024/3341"}, projects)["EncryptedProjectId"] == "abc"
    assert rajrera.match({"name": "Purple Melodia", "rera_id": None}, projects)["EncryptedProjectId"] == "def"
    assert rajrera.match({"name": "Unknown", "rera_id": None}, projects) is None


def test_doc_url_normalizes_paths():
    assert rajrera._doc_url("../Content/uploads/Letter+Maps.pdf") == "https://reraapp.rajasthan.gov.in/Content/uploads/Letter+Maps.pdf"
    assert rajrera._doc_url("../Content/uploads/My Plan.pdf") == "https://reraapp.rajasthan.gov.in/Content/uploads/My%20Plan.pdf"
