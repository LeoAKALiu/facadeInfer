import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi.testclient import TestClient
from PIL import Image

import api.index as index

if TYPE_CHECKING:
    from _pytest.monkeypatch import MonkeyPatch


def test_cases_thumbnails_use_demo_data_prefix() -> None:
    """The `/api/cases` endpoint should only return `/demo_data/` thumbnails."""
    client = TestClient(index.app)

    resp = client.get("/api/cases")
    assert resp.status_code == 200

    buildings = resp.json()
    assert isinstance(buildings, list)
    assert buildings, "Expected at least one demo building"

    for building in buildings:
        for facade in building["facades"]:
            assert facade["thumbnail"].startswith("/demo_data/")


def test_root_serves_html() -> None:
    """The root path `/` should serve the dashboard HTML (not a JSON 404)."""
    client = TestClient(index.app)

    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    assert "<!doctype html" in resp.text.lower()


def test_analyze_demo_images_use_demo_data_prefix(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    """The `/api/analyze_demo` endpoint should return `/demo_data/` image URLs."""
    demo_data_dir = tmp_path / "demo_data"
    demo_data_dir.mkdir(parents=True, exist_ok=True)

    case_id = "CASE_001"
    (demo_data_dir / f"{case_id}_ortho.json").write_text(
        json.dumps(
            {
                "shapes": [
                    {
                        "label": "window",
                        "points": [[0, 0], [10, 0], [10, 10], [0, 10]],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    # This is the image file `analyze_demo` reads for dimensions.
    img_path = demo_data_dir / f"{case_id}_ortho.jpg"
    Image.new("RGB", (64, 32), (255, 0, 0)).save(img_path)

    # Patch globals so the endpoint reads from our temp dir.
    monkeypatch.setattr(index, "DEMO_DATA_DIR", demo_data_dir)
    monkeypatch.setattr(index.semantic_analyzer, "analyze", lambda *_args, **_kwargs: {"ok": True})

    client = TestClient(index.app)
    resp = client.post("/api/analyze_demo", data={"case_id": case_id})
    assert resp.status_code == 200

    payload: dict[str, Any] = resp.json()
    assert payload["status"] == "success"
    assert payload["images"]["original"] == f"/demo_data/{case_id}.JPG"
    assert payload["images"]["processed"] == f"/demo_data/{case_id}_ortho.jpg"
    assert isinstance(payload["masks"], list)
