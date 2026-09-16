import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from services.model_pipeline import ModelPipelineService
from optimizer.maritime_fairways import MaritimeFairwayRouter, is_water_path


class TestPolarisFixes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pipeline = ModelPipelineService()
        cls.router = MaritimeFairwayRouter()

    def test_all_33_icebergs_loaded(self):
        positions, status = self.pipeline._load_usnic_positions()
        self.assertEqual(len(positions), 33, f"Expected 33 icebergs, got {len(positions)}")
        self.assertIn("A76C", positions)
        self.assertIn("D37", positions)
        self.assertIn("C36", positions)

    def test_global_fairway_land_avoidance_miami(self):
        # Route from Miami (25.76, -80.19) to Bharati (-69.41, 76.19)
        path = self.router.route_to_polar_gate(25.76, -80.19, target_lon=76.19)
        self.assertGreaterEqual(len(path), 3)
        for i in range(len(path) - 1):
            p1, p2 = path[i], path[i + 1]
            self.assertTrue(is_water_path(p1, p2), f"Segment {p1} -> {p2} intersects land!")

    def test_global_fairway_land_avoidance_indian_ocean(self):
        # Route from (25.0, 80.0) to Bharati (-69.41, 76.19)
        path = self.router.route_to_polar_gate(25.0, 80.0, target_lon=76.19)
        self.assertGreaterEqual(len(path), 2)
        for i in range(len(path) - 1):
            p1, p2 = path[i], path[i + 1]
            self.assertTrue(is_water_path(p1, p2), f"Segment {p1} -> {p2} intersects land!")


if __name__ == "__main__":
    unittest.main()
