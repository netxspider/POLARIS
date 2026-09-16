"""
POLARIS Live AISStream Service
Connects to AISStream WebSocket (wss://stream.aisstream.io/v0/stream)
and streams real-time global and polar maritime vessel transponders.
"""

import os
import json
import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import math

logger = logging.getLogger("polaris.ais")

# Default bounding boxes: Global maritime & Southern Ocean / Antarctic waters
DEFAULT_BBOXES = [
    [[-90.0, -180.0], [90.0, 180.0]]  # Global coverage
]

DEFAULT_MESSAGE_TYPES = [
    "PositionReport",
    "StandardClassBPositionReport",
    "ShipStaticData",
    "ExtendedClassBPositionReport"
]

# Realistic Southern Ocean polar supply ships and research icebreakers
POLAR_FALLBACK_FLEET: List[Dict[str, Any]] = [
    {
        "mmsi": "211232740",
        "name": "RV Polarstern",
        "type": "icebreaker",
        "lat": -66.5000,
        "lon": 18.2000,
        "speedKn": 11.2,
        "speed": 11.2,
        "course": 78.0,
        "heading": 76.0,
        "headingDeg": 76.0,
        "destination": "Neumayer III",
        "callsign": "DBLK",
        "is_simulated": True,
        "is_demo": True,
        "status_label": "DEMO / PRACTICE TARGET",
        "note": "Simulated training target for collision avoidance testing. Real vessel operates in home waters outside the austral summer."
    },
    {
        "mmsi": "273456110",
        "name": "Vasily Golovnin",
        "type": "icebreaker",
        "lat": -67.2000,
        "lon": 38.5000,
        "speedKn": 10.4,
        "speed": 10.4,
        "course": 85.0,
        "heading": 84.0,
        "headingDeg": 84.0,
        "destination": "Progress Station",
        "callsign": "UBDY",
        "is_simulated": True,
        "is_demo": True,
        "status_label": "DEMO / PRACTICE TARGET",
        "note": "Simulated training target for collision avoidance testing. Real vessel operates in Russia / home waters outside the austral summer."
    },
    {
        "mmsi": "601127000",
        "name": "SA Agulhas II",
        "type": "research",
        "lat": -68.4000,
        "lon": 20.1000,
        "speedKn": 9.8,
        "speed": 9.8,
        "course": 105.0,
        "heading": 102.0,
        "headingDeg": 102.0,
        "destination": "SANAE IV",
        "callsign": "ZR6367",
        "is_simulated": True,
        "is_demo": True,
        "status_label": "DEMO / PRACTICE TARGET",
        "note": "Simulated training target for collision avoidance testing. Real vessel operates in home waters outside the austral summer."
    },
    {
        "mmsi": "413349000",
        "name": "Xue Long 2",
        "type": "icebreaker",
        "lat": -68.9000,
        "lon": 75.2000,
        "speedKn": 12.0,
        "speed": 12.0,
        "course": 260.0,
        "heading": 262.0,
        "headingDeg": 262.0,
        "destination": "Zhongshan",
        "callsign": "BNEU",
        "is_simulated": True,
        "is_demo": True,
        "status_label": "DEMO / PRACTICE TARGET",
        "note": "Simulated training target for collision avoidance testing. Real vessel operates in home waters outside the austral summer."
    },
    {
        "mmsi": "273138300",
        "name": "Akademik Fedorov",
        "type": "research",
        "lat": -66.8000,
        "lon": 49.0000,
        "speedKn": 10.0,
        "speed": 10.0,
        "course": 92.0,
        "heading": 90.0,
        "headingDeg": 90.0,
        "destination": "Mirny Station",
        "callsign": "UACK",
        "is_simulated": True,
        "is_demo": True,
        "status_label": "DEMO / PRACTICE TARGET",
        "note": "Simulated training target for collision avoidance testing. Real vessel operates in Russia / home waters outside the austral summer."
    },
    {
        "mmsi": "232025740",
        "name": "RRS Sir David Attenborough",
        "type": "icebreaker",
        "lat": -65.9000,
        "lon": 30.5000,
        "speedKn": 11.5,
        "speed": 11.5,
        "course": 110.0,
        "heading": 108.0,
        "headingDeg": 108.0,
        "destination": "Rothera",
        "callsign": "ZDLP",
        "is_simulated": True,
        "is_demo": True,
        "status_label": "DEMO / PRACTICE TARGET",
        "note": "Simulated training target for collision avoidance testing. Real vessel operates in home waters outside the austral summer."
    }
]

class AISStreamService:
    def __init__(self):
        self.api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
        self.vessels: Dict[str, Dict[str, Any]] = {}
        self.status: str = "idle"
        self.last_update: Optional[str] = None
        self.error: Optional[str] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._fallback_vessels: List[Dict[str, Any]] = [dict(v) for v in POLAR_FALLBACK_FLEET]

    def advance_fallback_vessels(self, dt: float = 1.0):
        """Advances fallback polar vessels along their course over time dt."""
        for v in self._fallback_vessels:
            speed_kn = float(v.get("speedKn", v.get("speed", 10.0)))
            heading_deg = float(v.get("headingDeg", v.get("heading", v.get("course", 90.0))))
            speed_ms = speed_kn * 0.514444
            dist_m = speed_ms * dt
            theta = math.radians(heading_deg)
            dy_m = dist_m * math.cos(theta)
            dx_m = dist_m * math.sin(theta)

            meters_per_deg_lat = 111320.0
            meters_per_deg_lon = max(100.0, 111320.0 * math.cos(math.radians(v["lat"])))

            v["lat"] = round(v["lat"] + (dy_m / meters_per_deg_lat), 5)
            v["lon"] = round(v["lon"] + (dx_m / meters_per_deg_lon), 5)

    def get_fallback_vessels(self) -> List[Dict[str, Any]]:
        """Returns deep copy of current fallback polar fleet state."""
        return [dict(v) for v in self._fallback_vessels]

    def get_status(self) -> Dict[str, Any]:
        all_vessels = self.get_vessels()
        return {
            "has_key": bool(self.api_key),
            "status": self.status if self.status != "idle" else ("fallback" if len(self.vessels) < 2 else "idle"),
            "vessel_count": len(all_vessels),
            "live_count": len(self.vessels),
            "fallback_active": len(self.vessels) < 2,
            "last_update": self.last_update or (datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")),
            "error": self.error
        }

    def get_vessels(self, limit: int = 500) -> List[Dict[str, Any]]:
        # Return recent active vessels; if fewer than 2 vessels, include polar fallback fleet
        v_list = list(self.vessels.values())
        if len(v_list) < 2:
            now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            live_mmsis = {str(v.get("mmsi")) for v in v_list}
            merged = list(v_list)
            for fb in self._fallback_vessels:
                if str(fb.get("mmsi")) not in live_mmsis:
                    fb_copy = dict(fb)
                    fb_copy["updated_at"] = now_iso
                    merged.append(fb_copy)
            return merged[:limit]
        return v_list[:limit]

    def record_vessel(self, mmsi: str, data: Dict[str, Any]):
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        if mmsi in self.vessels:
            self.vessels[mmsi].update(data)
            self.vessels[mmsi]["updated_at"] = now_iso
        else:
            data["mmsi"] = mmsi
            data["created_at"] = now_iso
            data["updated_at"] = now_iso
            self.vessels[mmsi] = data
        self.last_update = now_iso

        # Bound capacity to 5000 vessels in memory
        if len(self.vessels) > 5000:
            oldest_keys = list(self.vessels.keys())[:500]
            for k in oldest_keys:
                self.vessels.pop(k, None)

    async def start(self):
        if not self.api_key:
            self.status = "fallback"
            self.error = "AISSTREAM_API_KEY is not set (polar fallback fleet active)"
            logger.info("AISStream service using polar fallback fleet: AISSTREAM_API_KEY missing")
            return

        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._stream_loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.status = "closed"

    async def _stream_loop(self):
        import websockets

        url = "wss://stream.aisstream.io/v0/stream"
        subscription = {
            "APIKey": self.api_key,
            "BoundingBoxes": DEFAULT_BBOXES,
            "FilterMessageTypes": DEFAULT_MESSAGE_TYPES
        }

        while self._running:
            try:
                self.status = "connecting"
                self.error = None
                logger.info("Connecting to AISStream: %s", url)

                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    await ws.send(json.dumps(subscription))
                    self.status = "open"
                    logger.info("AISStream connected & subscribed successfully.")

                    async for raw_msg in ws:
                        if not self._running:
                            break
                        try:
                            msg = json.loads(raw_msg)
                            self._process_ais_message(msg)
                        except Exception as parse_err:
                            logger.debug("AIS parse error: %s", parse_err)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.status = "error"
                self.error = str(e)
                logger.warning("AISStream connection error: %s. Retrying in 10s...", e)
                await asyncio.sleep(10)

    def _process_ais_message(self, msg: Dict[str, Any]):
        msg_type = msg.get("MessageType")
        meta = msg.get("MetaData", {})
        mmsi = str(meta.get("MMSI", "")).strip()

        if not mmsi:
            return

        lat = meta.get("latitude")
        lon = meta.get("longitude")
        ship_name = meta.get("ShipName", "").strip() or f"VESSEL-{mmsi}"

        v_data = {
            "name": ship_name,
            "mmsi": mmsi,
            "type": "cargo"
        }

        if lat is not None and lon is not None:
            v_data["lat"] = float(lat)
            v_data["lon"] = float(lon)

        if "PositionReport" in msg:
            rep = msg["PositionReport"]
            sog = rep.get("Sog")
            cog = rep.get("Cog")
            hdg = rep.get("TrueHeading")
            if sog is not None:
                v_data["speed"] = float(sog)
            if cog is not None:
                v_data["course"] = float(cog)
            if hdg is not None and hdg < 360:
                v_data["heading"] = float(hdg)

        elif "ShipStaticData" in msg:
            st = msg["ShipStaticData"]
            t_code = st.get("Type")
            dest = st.get("Destination", "").strip()
            callsign = st.get("CallSign", "").strip()
            if t_code is not None:
                v_data["type"] = str(t_code)
            if dest:
                v_data["destination"] = dest
            if callsign:
                v_data["callsign"] = callsign

        self.record_vessel(mmsi, v_data)
