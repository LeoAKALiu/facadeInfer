import cv2
import numpy as np
import os
from fastapi.testclient import TestClient
from backend.main import app
import json


def test_pipeline():
    # 1. Create Dummy Image
    img_path = "backend/test_data/test_building.jpg"
    img = np.zeros((800, 600, 3), dtype=np.uint8)
    # Draw a "building"
    cv2.rectangle(img, (100, 100), (500, 700), (200, 200, 200), -1)
    cv2.imwrite(img_path, img)

    assert os.path.exists(img_path)

    # 2. Test Client
    client = TestClient(app)

    # 3. Send Request
    with open(img_path, "rb") as f:
        response = client.post(
            "/analyze", files={"file": ("test_building.jpg", f, "image/jpeg")}
        )

    # 4. Verify Response
    assert response.status_code == 200
    data = response.json()

    print("Response Data:", json.dumps(data, indent=2))

    assert data["status"] == "success"
    assert "risk_report" in data
    assert "images" in data
    assert "cad" in data
    assert data["risk_report"]["risk_soft_story"] in ["HIGH", "LOW"]

    # 5. Verify Artifacts
    processed_url = data["images"]["processed"]
    dxf_url = data["cad"]["dxf_url"]

    # Convert URLs to local paths (assuming running from root)
    # URL: /static/filename -> backend/static/filename
    processed_path = f"backend{processed_url}"
    dxf_path = f"backend{dxf_url}"

    assert os.path.exists(processed_path)
    assert os.path.exists(dxf_path)

    print("Verification Successful!")


if __name__ == "__main__":
    test_pipeline()
