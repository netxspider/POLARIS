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
        # Route from Miami (25.788, -80.177) to Bharati (-69.41, 76.19)
        path = self.router.route_to_polar_gate(25.788, -80.177, target_lon=76.19)
        self.assertGreaterEqual(len(path), 3)
        for i in range(len(path) - 1):
            p1, p2 = path[i], path[i + 1]
            self.assertTrue(is_water_path(p1, p2), f"Segment {p1} -> {p2} intersects land!")

    def test_american_port_positive_longitude_auto_correction(self):
        # User entered Miami coordinates without minus sign: (25.788, 80.177)
        path = self.router.route_to_polar_gate(25.788, 80.177, target_lon=76.19)
        self.assertGreaterEqual(len(path), 3)
        # Verify it starts off Florida / Atlantic, NOT India
        self.assertLess(path[0][1], -70.0, "Route should start in Western Atlantic off Florida")
        for i in range(len(path) - 1):
            p1, p2 = path[i], path[i + 1]
            self.assertTrue(is_water_path(p1, p2), f"Segment {p1} -> {p2} intersects land!")

    def test_global_fairway_land_avoidance_indian_ocean(self):
        # Route from Goa / Mormugao (15.4, 73.8) to Bharati (-69.41, 76.19)
        path = self.router.route_to_polar_gate(15.4, 73.8, target_lon=76.19)
        self.assertGreaterEqual(len(path), 2)
        for i in range(len(path) - 1):
            p1, p2 = path[i], path[i + 1]
            self.assertTrue(is_water_path(p1, p2), f"Segment {p1} -> {p2} intersects land!")


    def test_polar_entry_avoids_boundary_crawl(self):
        # Miami -> Bharati
        path = self.router.route_to_polar_gate(25.788, -80.177, target_lat=-69.41, target_lon=76.19)
        polar_gate = path[-1]
        # Should enter near 0°E (Atlantic sector), NOT crawl all the way to 76°E along -50°S
        self.assertEqual(polar_gate[0], -50.0)
        self.assertLessEqual(polar_gate[1], 10.0, f"Expected gate <= 10.0°E, got {polar_gate[1]}°E")
        # Ensure path does not contain intermediate boundary crawl gates
        gate_lons = [p[1] for p in path if p[0] == -50.0]
        self.assertEqual(len(gate_lons), 1, f"Expected exactly 1 gate at -50°S, got {len(gate_lons)}: {gate_lons}")


if __name__ == "__main__":
    unittest.main()
