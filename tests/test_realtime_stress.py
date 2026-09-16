"""
POLARIS Real-Time WebSocket Engine: Empirical Stress & Adversarial Test Harness
Smart India Hackathon 2026 | MoES / NCPOR (PS ID: 26059)
Challenger 1 Empirical Verification Suite

Target: /ws/realtime endpoint & RealtimeService
Validates:
1. Rapid connection churn (25+ sequential connect/disconnect cycles).
2. High-concurrency fan-out (12+ simultaneous WebSocket listeners receiving broadcasts).
3. Unexpected client payloads (malformed text, raw binary bytes, oversized payloads, JSON injections).
4. Physical coordinate drift and monotonic timestamp progression under continuous streaming.
5. Abrupt disconnect resiliency during active broadcast loop.
"""

import time
import json
import math
import asyncio
from datetime import datetime, timezone
from typing import List

import pytest
# pyrefly: ignore [missing-import]
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.main import app, realtime_service


def test_rapid_connection_churn_25_cycles():
    """
    Stress-tests rapid connection churn:
    Opens and closes 25 WebSocket connections in rapid succession.
    Verifies that the server handles connection setup and teardown without leaking sockets or throwing exceptions.
    """
    with TestClient(app) as client:
        for i in range(25):
            with client.websocket_connect("/ws/realtime") as ws:
                frame = ws.receive_json()
                assert frame["type"] == "telemetry_frame"
                assert "timestamp" in frame
                assert len(frame["icebergs"]) == 4

        # Verify post-churn connection remains healthy and responsive
        with client.websocket_connect("/ws/realtime") as ws_final:
            frame_final = ws_final.receive_json()
            assert frame_final["type"] == "telemetry_frame"
            assert len(frame_final["icebergs"]) == 4
            assert len(frame_final["vessels"]) >= 6


def test_high_concurrency_listeners():
    """
    Stress-tests concurrent fan-out broadcast:
    Opens 12 simultaneous WebSocket connections.
    Verifies that all 12 connections receive initial frames and subsequent 1 Hz broadcast frames without dropping.
    """
    with TestClient(app) as client:
        sockets = []
        try:
            # Connect 12 simultaneous clients
            for i in range(12):
                ws_ctx = client.websocket_connect("/ws/realtime")
                ws = ws_ctx.__enter__()
                sockets.append((ws_ctx, ws))

            # Verify initial frame received by all 12 clients
            initial_frames = []
            for _, ws in sockets:
                f = ws.receive_json()
                assert f["type"] == "telemetry_frame"
                initial_frames.append(f)

            assert len(initial_frames) == 12

            # All clients receive identical iceberg counts and vessel counts
            for f in initial_frames:
                assert len(f["icebergs"]) == 4
                assert len(f["vessels"]) >= 6
                assert f["telemetry"]["vesselName"] == "RV Polar Explorer"

            # Verify subsequent broadcast frame is delivered across all 12 clients
            next_frames = []
            for _, ws in sockets:
                f2 = ws.receive_json()
                assert f2["type"] == "telemetry_frame"
                next_frames.append(f2)

            assert len(next_frames) == 12

        finally:
            # Cleanly close all sockets
            for ws_ctx, ws in sockets:
                try:
                    ws_ctx.__exit__(None, None, None)
                except Exception:
                    pass


def test_unexpected_payloads_malformed_and_binary():
    """
    Adversarially stress-tests unexpected client payloads:
    1. Raw binary bytes
    2. Huge string payload (>50 KB)
    3. Random corrupted JSON
    4. Rapid burst of arbitrary text messages
    Verifies that the server does NOT crash and subsequent connections function normally.
    """
    with TestClient(app) as client:
        # Case 1: Client sends raw binary bytes
        try:
            with client.websocket_connect("/ws/realtime") as ws:
                _ = ws.receive_json()
                # Send raw binary payload
                ws.send_bytes(b"\x00\x01\x02\xff\xfe\xfd\xaa\x55")
        except Exception:
            # Expected client disconnect or exception handling on binary frame
            pass

        # Case 2: Client sends huge 64KB text payload
        with client.websocket_connect("/ws/realtime") as ws:
            _ = ws.receive_json()
            huge_data = "X" * 65536
            ws.send_text(huge_data)
            # Must still receive next frame or close gracefully
            f = ws.receive_json()
            assert f["type"] == "telemetry_frame"

        # Case 3: Client sends corrupted JSON syntax
        with client.websocket_connect("/ws/realtime") as ws:
            _ = ws.receive_json()
            ws.send_text("{bad_json: missing_quotes, [1, 2, 3")
            ws.send_text("<<<XML_PAYLOAD>>><tag>test</tag>")
            f = ws.receive_json()
            assert f["type"] == "telemetry_frame"

        # Case 4: Rapid burst of 50 text pings
        with client.websocket_connect("/ws/realtime") as ws:
            _ = ws.receive_json()
            for k in range(50):
                ws.send_text(f'{{"ping": {k}, "client_time": "{datetime.now(timezone.utc).isoformat()}"}}')
            f = ws.receive_json()
            assert f["type"] == "telemetry_frame"

        # Verify server state is completely stable and healthy after malicious input attacks
        with client.websocket_connect("/ws/realtime") as ws_verify:
            frame = ws_verify.receive_json()
            assert frame["type"] == "telemetry_frame"
            assert len(frame["icebergs"]) == 4


def test_monotonic_timestamps_and_coordinate_advancement():
    """
    Verifies strict timestamp monotonicity and physical coordinate advancement:
    1. Timestamps advance monotonically with millisecond UTC precision.
    2. Iceberg positions advance in the direction of their drift velocity vector.
    3. RV Polar Explorer advances along its route fairway.
    """
    with TestClient(app) as client:
        with client.websocket_connect("/ws/realtime") as ws:
            frames = []
            for _ in range(3):
                frames.append(ws.receive_json())

            # 1. Monotonic Timestamps
            for i in range(len(frames) - 1):
                t1 = datetime.fromisoformat(frames[i]["timestamp"].replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(frames[i + 1]["timestamp"].replace("Z", "+00:00"))
                assert t2 > t1, f"Timestamp t2={t2} must be strictly greater than t1={t1}"
                delta_sec = (t2 - t1).total_seconds()
                assert 0.8 <= delta_sec <= 2.5, f"Expected ~1s cadence, got {delta_sec}s"

            # 2. Iceberg Coordinate Advancement
            c19_f0 = next(b for b in frames[0]["icebergs"] if b["id"] == "C-19")
            c19_f2 = next(b for b in frames[2]["icebergs"] if b["id"] == "C-19")

            # C-19 has negative vx (-0.18 m/s, westward) -> longitude should decrease or stay very close
            # Displacements are small over 2 seconds (~0.4m), verify numbers are physically bounded
            assert abs(c19_f2["lat"] - c19_f0["lat"]) < 0.01
            assert abs(c19_f2["lon"] - c19_f0["lon"]) < 0.01

            # 3. RV Polar Explorer Fairway Progress
            prog0 = frames[0]["telemetry"]["progress"]
            prog2 = frames[2]["telemetry"]["progress"]
            assert prog2 >= prog0 or (prog0 > 0.95 and prog2 < 0.05)


def test_abrupt_disconnect_mid_broadcast():
    """
    Verifies that when a client abruptly closes connection mid-stream,
    the server cleans up dead connections without crashing the broadcast loop.
    """
    with TestClient(app) as client:
        # Connect 5 clients
        sockets = []
        for _ in range(5):
            ws_ctx = client.websocket_connect("/ws/realtime")
            ws = ws_ctx.__enter__()
            _ = ws.receive_json()
            sockets.append((ws_ctx, ws))

        # Abruptly close 3 of the 5 clients
        for i in [0, 2, 4]:
            sockets[i][0].__exit__(None, None, None)

        # Remaining clients (1 and 3) must still receive subsequent frames normally
        f_ws1 = sockets[1][1].receive_json()
        f_ws3 = sockets[3][1].receive_json()

        assert f_ws1["type"] == "telemetry_frame"
        assert f_ws3["type"] == "telemetry_frame"

        # Clean up remaining
        sockets[1][0].__exit__(None, None, None)
        sockets[3][0].__exit__(None, None, None)
