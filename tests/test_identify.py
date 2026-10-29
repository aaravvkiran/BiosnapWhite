"""Endpoint tests stub out inference; they do NOT measure species accuracy."""
import io
import unittest
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app


def tiny_jpg():
    img = Image.new("RGB", (24, 24), "white")
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    return buffer.getvalue()


class TestIdentify(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_anoplophora_lucipor_triggers_warning_without_confirming_alb(self):
        fake_result = {
            "species": [{"species": "Anoplophora lucipor", "genus": "Anoplophora", "family": "Cerambycidae", "score": 0.70}],
            "genera": [{"genus": "Anoplophora", "score": 0.80}],
            "lookalikes": [{"classification": "Anoplophora glabripennis", "score": 0.60}, {"classification": "Anoplophora lucipor", "score": 0.40}],
            "possible_alb": True,
        }
        with patch("app.main.predict_with_model", return_value=fake_result):
            r = self.client.post("/api/identify", files={"file": ("beetle.jpg", tiny_jpg(), "image/jpeg")})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["possible_alb"])
        self.assertEqual(data["identification_status"], "needs_expert_verification")
        self.assertTrue(data["review_required"])
        self.assertEqual(data["predictions"][0]["scientific_name"], "Anoplophora lucipor")
        self.assertFalse(data["predictions"][0]["in_local_catalog"])
        self.assertEqual(data["alb_reference"]["scientific_name"], "Anoplophora glabripennis")
        self.assertEqual(data["lookalike_comparison"][0]["scientific_name"], "Anoplophora glabripennis")

    def test_unrelated_image_does_not_trigger_alb_warning(self):
        fake_result = {
            "species": [{"species": "Ailanthus altissima", "genus": "Ailanthus", "family": "Simaroubaceae", "score": 0.5}],
            "genera": [{"genus": "Ailanthus", "score": 0.7}],
            "lookalikes": [],
            "possible_alb": False,
        }
        with patch("app.main.predict_with_model", return_value=fake_result):
            r = self.client.post("/api/identify", files={"file": ("plant.jpg", tiny_jpg(), "image/jpeg")})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertFalse(data["possible_alb"])
        self.assertTrue(data["predictions"][0]["in_local_catalog"])
        self.assertEqual(data["lookalike_comparison"], [])


if __name__ == "__main__":
    unittest.main()
