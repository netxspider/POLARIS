"""
Generates standard glTF 2.0 Polar Research Icebreaker Model.
Conforms strictly to glTF 2.0 Specification & Cesium Engine glTF importer:
- +Y is UP (Vertical mast / sky)
- +Z is FORWARD (Bow heading along velocity direction)
- -Z is AFT (Stern)
- +X is STARBOARD (Right side)
- -X is PORT (Left side)
"""

import json
import struct
import os
import math

def create_gltf_standard_polar_ship(output_path: str):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    vertices = []
    normals = []
    colors = []
    indices = []

    def add_tri(v1, v2, v3, col, n=None):
        base_idx = len(vertices) // 3
        if n is None:
            ax, ay, az = v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]
            bx, by, bz = v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]
            nx = ay * bz - az * by
            ny = az * bx - ax * bz
            nz = ax * by - ay * bx
            nl = math.sqrt(nx*nx + ny*ny + nz*nz) or 1.0
            n = [nx/nl, ny/nl, nz/nl]
        for v in (v1, v2, v3):
            vertices.extend(v)
            normals.extend(n)
            colors.extend(col)
        indices.extend([base_idx, base_idx + 1, base_idx + 2])

    def add_quad(v1, v2, v3, v4, col, n=None):
        # Counter-clockwise winding: v1 -> v2 -> v3, then v1 -> v3 -> v4
        add_tri(v1, v2, v3, col, n)
        add_tri(v1, v3, v4, col, n)

    def add_box(x1, y1, z1, x2, y2, z2, col):
        # x: stbd(+X)/port(-X), y: up(+Y), z: bow(+Z)/stern(-Z)
        p1 = [x1, y1, z1]  # port, bot, stern
        p2 = [x2, y1, z1]  # stbd, bot, stern
        p3 = [x2, y2, z1]  # stbd, top, stern
        p4 = [x1, y2, z1]  # port, top, stern
        p5 = [x1, y1, z2]  # port, bot, bow
        p6 = [x2, y1, z2]  # stbd, bot, bow
        p7 = [x2, y2, z2]  # stbd, top, bow
        p8 = [x1, y2, z2]  # port, top, bow

        add_quad(p4, p3, p7, p8, col, [0, 1, 0])   # Top (+Y Up)
        add_quad(p1, p2, p6, p5, col, [0, -1, 0])  # Bottom (-Y Keel)
        add_quad(p5, p6, p7, p8, col, [0, 0, 1])   # Front (+Z Bow)
        add_quad(p2, p1, p4, p3, col, [0, 0, -1])  # Back (-Z Stern)
        add_quad(p6, p2, p3, p7, col, [1, 0, 0])   # Starboard (+X Right)
        add_quad(p1, p5, p8, p4, col, [-1, 0, 0])  # Port (-X Left)

    def add_cylinder(x, z, y_bot, y_top, r, col, segments=12):
        top_center = [x, y_top, z]
        bot_center = [x, y_bot, z]
        ring_top = []
        ring_bot = []
        for i in range(segments):
            ang = (2.0 * math.pi * i) / segments
            cx = x + r * math.cos(ang)
            cz = z + r * math.sin(ang)
            ring_top.append([cx, y_top, cz])
            ring_bot.append([cx, y_bot, cz])

        for i in range(segments):
            nxt = (i + 1) % segments
            add_tri(top_center, ring_top[i], ring_top[nxt], col, [0, 1, 0])
            add_tri(bot_center, ring_bot[nxt], ring_bot[i], col, [0, -1, 0])
            ang_mid = (2.0 * math.pi * (i + 0.5)) / segments
            nx, nz = math.cos(ang_mid), math.sin(ang_mid)
            add_quad(ring_bot[i], ring_bot[nxt], ring_top[nxt], ring_top[i], col, [nx, 0, nz])

    # Authentic Polar Palette
    HULL_RED = [0.82, 0.16, 0.14, 1.0]
    HULL_KEEL = [0.55, 0.08, 0.10, 1.0]
    HULL_ICE_BELT = [0.18, 0.20, 0.24, 1.0]
    DECK_GRAY = [0.65, 0.68, 0.72, 1.0]
    SUPERSTRUCTURE_WHITE = [0.94, 0.95, 0.98, 1.0]
    BRIDGE_GLASS = [0.10, 0.35, 0.65, 0.95]
    FUNNEL_NAVY = [0.08, 0.18, 0.38, 1.0]
    FUNNEL_GOLD = [0.95, 0.75, 0.12, 1.0]
    CRANE_YELLOW = [0.96, 0.78, 0.10, 1.0]
    LIFEBOAT_ORANGE = [0.98, 0.42, 0.05, 1.0]
    HELIDECK_GREEN = [0.18, 0.45, 0.30, 1.0]
    RADOME_WHITE = [0.98, 0.98, 0.96, 1.0]
    LIGHT_PORT_RED = [1.0, 0.05, 0.05, 1.0]
    LIGHT_STBD_GREEN = [0.05, 1.0, 0.2, 1.0]
    LIGHT_MAST_WHITE = [1.0, 1.0, 0.8, 1.0]

    # --- 1. Hydrodynamic Icebreaker Hull (Length: -45m Stern to +45m Bow, Height: 0m to 14m) ---
    # Stations along Z (Keel is at y=0.0, Deck is at y=12.0-14.0m)
    stations = [
        # z, half_beam_bot, half_beam_deck, y_bot, y_deck
        (-45.0, 4.5, 7.5, 0.0, 12.0),   # Stern transom
        (-35.0, 7.5, 9.2, 0.0, 12.0),   # Aft working deck
        (-15.0, 8.8, 9.6, 0.0, 12.5),   # Midship aft
        (10.0,  8.8, 9.6, 0.0, 12.5),   # Midship fwd
        (25.0,  7.2, 9.0, 0.5, 13.5),   # Forecastle start
        (38.0,  3.8, 6.5, 1.5, 14.8),   # Raked icebreaker bow
        (46.0,  0.3, 0.8, 3.5, 15.5)    # Ice knife stem tip
    ]

    for i in range(len(stations) - 1):
        z1, w_bot1, w_top1, y_bot1, y_top1 = stations[i]
        z2, w_bot2, w_top2, y_bot2, y_top2 = stations[i + 1]

        # Port points (-X)
        p_bot1 = [-w_bot1, y_bot1, z1]
        p_top1 = [-w_top1, y_top1, z1]
        p_bot2 = [-w_bot2, y_bot2, z2]
        p_top2 = [-w_top2, y_top2, z2]

        # Starboard points (+X)
        s_bot1 = [w_bot1, y_bot1, z1]
        s_top1 = [w_top1, y_top1, z1]
        s_bot2 = [w_bot2, y_bot2, z2]
        s_top2 = [w_top2, y_top2, z2]

        # Keel points
        k1 = [0.0, y_bot1, z1]
        k2 = [0.0, y_bot2, z2]

        # Port Topsides (-X)
        add_quad(p_bot1, p_bot2, p_top2, p_top1, HULL_RED, [-1, 0.2, 0])
        # Starboard Topsides (+X)
        add_quad(s_bot2, s_bot1, s_top1, s_top2, HULL_RED, [1, 0.2, 0])
        # Port Bottom Keel
        add_quad(k1, k2, p_bot2, p_bot1, HULL_KEEL, [0, -1, 0])
        # Starboard Bottom Keel
        add_quad(s_bot1, s_bot2, k2, k1, HULL_KEEL, [0, -1, 0])

        # Weather Deck (Top)
        add_quad(p_top2, s_top2, s_top1, p_top1, DECK_GRAY, [0, 1, 0])

        # Ice Belt Band (Reinforced dark steel band around waterline)
        y_b_belt = y_bot1 + 5.0
        y_t_belt = y_b_belt + 3.0
        add_quad([-w_top1*0.99, y_b_belt, z1], [-w_top2*0.99, y_b_belt, z2], [-w_top2*0.99, y_t_belt, z2], [-w_top1*0.99, y_t_belt, z1], HULL_ICE_BELT, [-1, 0, 0])
        add_quad([w_top2*0.99, y_b_belt, z2], [w_top1*0.99, y_b_belt, z1], [w_top1*0.99, y_t_belt, z1], [w_top2*0.99, y_t_belt, z2], HULL_ICE_BELT, [1, 0, 0])

    # Transom Stern Closure (-Z)
    z_st, w_b_st, w_t_st, y_b_st, y_t_st = stations[0]
    p_b_st = [-w_b_st, y_b_st, z_st]
    p_t_st = [-w_t_st, y_t_st, z_st]
    s_b_st = [w_b_st, y_b_st, z_st]
    s_t_st = [w_t_st, y_t_st, z_st]
    add_quad(p_b_st, s_b_st, s_t_st, p_t_st, HULL_RED, [0, 0, -1])

    # --- 2. Multi-tier Accommodation Superstructure & Navigation Bridge ---
    # Tier 1: Accommodations & Main Labs (y = 12.0 to 18.0, z = -8 to +18)
    add_box(-7.5, 12.0, -8.0, 7.5, 18.0, 18.0, SUPERSTRUCTURE_WHITE)

    # Tier 2: Officer Quarters & Radio Room (y = 18.0 to 22.5, z = -4 to +16)
    add_box(-7.0, 18.0, -4.0, 7.0, 22.5, 16.0, SUPERSTRUCTURE_WHITE)

    # Tier 3: Panoramic Navigation Bridge (y = 22.5 to 27.0, z = 2 to 14)
    add_box(-6.8, 22.5, 2.0, 6.8, 27.0, 14.0, SUPERSTRUCTURE_WHITE)

    # Bridge Wings Overhang (Port -X, Starboard +X)
    add_box(-10.5, 23.0, 7.0, -6.8, 27.0, 13.5, SUPERSTRUCTURE_WHITE)   # Port Wing (-X)
    add_box(6.8, 23.0, 7.0, 10.5, 27.0, 13.5, SUPERSTRUCTURE_WHITE)    # Stbd Wing (+X)

    # Bridge Windows (Forward Facing +Z)
    add_box(-6.5, 23.8, 13.8, 6.5, 26.2, 14.1, BRIDGE_GLASS)
    add_box(-10.4, 23.8, 13.3, -6.8, 26.2, 13.6, BRIDGE_GLASS)   # Port Wing Front
    add_box(6.8, 23.8, 13.3, 10.4, 26.2, 13.6, BRIDGE_GLASS)    # Stbd Wing Front

    # Navigation Position Lights (Port -X = Red, Starboard +X = Green)
    add_box(-10.7, 26.2, 13.0, -10.3, 26.8, 13.5, LIGHT_PORT_RED)   # Port (Red)
    add_box(10.3, 26.2, 13.0, 10.7, 26.8, 13.5, LIGHT_STBD_GREEN)   # Starboard (Green)

    # --- 3. Radar Lattice Mast & Communications Tower ---
    # Mast Tower at z = 8.0, y = 27.0 to 38.0m
    add_box(-0.9, 27.0, 7.2, 0.9, 37.0, 8.8, CRANE_YELLOW)
    # Yardarm Crossbar
    add_box(-5.0, 34.5, 7.6, 5.0, 35.3, 8.4, CRANE_YELLOW)
    # Masthead 360 White Light
    add_box(-0.3, 37.0, 8.6, 0.3, 37.6, 9.0, LIGHT_MAST_WHITE)
    # Rotating Radar Scanner Bar
    add_box(-3.0, 37.2, 7.0, 3.0, 37.8, 7.4, [0.1, 0.1, 0.1, 1.0])
    # Satellite Communications Radomes
    add_cylinder(-3.5, 7.0, 27.0, 30.5, 1.4, RADOME_WHITE)   # Port radome
    add_cylinder(3.5, 7.0, 27.0, 30.5, 1.4, RADOME_WHITE)    # Stbd radome

    # --- 4. Twin Marine Exhaust Stacks / Funnels ---
    add_box(-5.5, 18.0, -7.0, -2.2, 26.0, 0.0, FUNNEL_NAVY)    # Port Funnel
    add_box(-5.6, 22.5, -6.8, -2.1, 23.8, -0.2, FUNNEL_GOLD)   # Gold Band
    add_cylinder(-3.85, -3.5, 26.0, 27.5, 0.9, [0.15, 0.15, 0.15, 1.0])

    add_box(2.2, 18.0, -7.0, 5.5, 26.0, 0.0, FUNNEL_NAVY)     # Stbd Funnel
    add_box(2.1, 22.5, -6.8, 5.6, 23.8, -0.2, FUNNEL_GOLD)    # Gold Band
    add_cylinder(3.85, -3.5, 26.0, 27.5, 0.9, [0.15, 0.15, 0.15, 1.0])

    # --- 5. Enclosed Polar Lifeboats on Davits ---
    add_cylinder(-8.8, 2.0, 18.5, 20.0, 1.6, LIFEBOAT_ORANGE, segments=8)
    add_box(-9.2, 18.2, -3.0, -8.4, 20.4, 7.0, LIFEBOAT_ORANGE)  # Port Lifeboat
    add_cylinder(8.8, 2.0, 18.5, 20.0, 1.6, LIFEBOAT_ORANGE, segments=8)
    add_box(8.4, 18.2, -3.0, 9.2, 20.4, 7.0, LIFEBOAT_ORANGE)   # Stbd Lifeboat

    # --- 6. Aft Helideck & Stern Oceanographic A-Frame ---
    # Helideck (x = -8.0 to +8.0, y = 12.2 to 12.8, z = -42 to -20)
    add_box(-8.0, 12.2, -42.0, 8.0, 12.8, -20.0, HELIDECK_GREEN)
    # Helipad 'H' Marking
    add_box(-0.9, 12.82, -35.0, 0.9, 12.86, -27.0, SUPERSTRUCTURE_WHITE)
    add_box(-4.0, 12.82, -32.0, 4.0, 12.86, -30.0, SUPERSTRUCTURE_WHITE)
    add_box(-4.0, 12.82, -35.0, -2.2, 12.86, -27.0, SUPERSTRUCTURE_WHITE)
    add_box(2.2, 12.82, -35.0, 4.0, 12.86, -27.0, SUPERSTRUCTURE_WHITE)

    # Oceanographic A-Frame Gantry Crane at Stern (z = -44)
    add_box(-6.5, 12.0, -44.0, -5.0, 23.5, -42.0, CRANE_YELLOW)  # Port Leg
    add_box(5.0, 12.0, -44.0, 6.5, 23.5, -42.0, CRANE_YELLOW)   # Stbd Leg
    add_box(-6.5, 22.5, -44.0, 6.5, 24.0, -42.0, CRANE_YELLOW)  # Crossbeam

    # --- 7. Foredeck Heavy-Duty Cargo Crane ---
    add_cylinder(0.0, 24.0, 13.0, 17.5, 1.2, CRANE_YELLOW)
    add_box(-1.4, 17.5, 22.0, 1.4, 20.8, 25.5, CRANE_YELLOW)
    add_box(-0.6, 19.8, 24.0, 0.6, 21.6, 38.0, CRANE_YELLOW)  # Jib boom pointing forward (+Z)

    # --- 8. Binary glTF assembly ---
    vert_bytes = struct.pack(f'{len(vertices)}f', *vertices)
    norm_bytes = struct.pack(f'{len(normals)}f', *normals)
    col_bytes = struct.pack(f'{len(colors)}f', *colors)
    idx_bytes = struct.pack(f'{len(indices)}H', *indices)

    min_x, max_x = min(vertices[0::3]), max(vertices[0::3])
    min_y, max_y = min(vertices[1::3]), max(vertices[1::3])
    min_z, max_z = min(vertices[2::3]), max(vertices[2::3])

    idx_len = len(idx_bytes)
    idx_pad = (4 - (idx_len % 4)) % 4
    idx_bytes += b'\x00' * idx_pad

    vert_offset = len(idx_bytes)
    vert_len = len(vert_bytes)
    norm_offset = vert_offset + vert_len
    norm_len = len(norm_bytes)
    col_offset = norm_offset + norm_len
    col_len = len(col_bytes)

    bin_data = idx_bytes + vert_bytes + norm_bytes + col_bytes
    total_bin_len = len(bin_data)

    gltf = {
        "asset": {"version": "2.0", "generator": "POLARIS glTF Standard Ship Generator"},
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "PolarResearchVessel", "mesh": 0}],
        "meshes": [{
            "name": "ShipMesh",
            "primitives": [{
                "attributes": {
                    "POSITION": 1,
                    "NORMAL": 2,
                    "COLOR_0": 3
                },
                "indices": 0,
                "material": 0
            }]
        }],
        "materials": [{
            "name": "ShipHullAndSuperstructure",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.15,
                "roughnessFactor": 0.60
            },
            "doubleSided": True
        }],
        "accessors": [
            {
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5123,
                "count": len(indices),
                "type": "SCALAR",
                "max": [max(indices)],
                "min": [min(indices)]
            },
            {
                "bufferView": 1,
                "byteOffset": 0,
                "componentType": 5126,
                "count": len(vertices) // 3,
                "type": "VEC3",
                "max": [max_x, max_y, max_z],
                "min": [min_x, min_y, min_z]
            },
            {
                "bufferView": 2,
                "byteOffset": 0,
                "componentType": 5126,
                "count": len(normals) // 3,
                "type": "VEC3",
                "max": [1.0, 1.0, 1.0],
                "min": [-1.0, -1.0, -1.0]
            },
            {
                "bufferView": 3,
                "byteOffset": 0,
                "componentType": 5126,
                "count": len(colors) // 4,
                "type": "VEC4",
                "max": [1.0, 1.0, 1.0, 1.0],
                "min": [0.0, 0.0, 0.0, 0.0]
            }
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": idx_len, "target": 34963},
            {"buffer": 0, "byteOffset": vert_offset, "byteLength": vert_len, "target": 34962},
            {"buffer": 0, "byteOffset": norm_offset, "byteLength": norm_len, "target": 34962},
            {"buffer": 0, "byteOffset": col_offset, "byteLength": col_len, "target": 34962}
        ],
        "buffers": [{"byteLength": total_bin_len}]
    }

    json_str = json.dumps(gltf, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b' ' * json_pad

    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_data)
    header = struct.pack('<4sII', b'glTF', 2, total_length)
    chunk0_header = struct.pack('<II', len(json_bytes), 0x4E4F534A)
    chunk1_header = struct.pack('<II', len(bin_data), 0x004E4942)

    with open(output_path, 'wb') as f:
        f.write(header)
        f.write(chunk0_header)
        f.write(json_bytes)
        f.write(chunk1_header)
        f.write(bin_data)

    print(f"Generated Standard glTF Polar Ship at: {output_path} ({total_length} bytes)")

if __name__ == "__main__":
    out1 = os.path.join(os.path.dirname(__file__), "frontend", "public", "models", "polar_ship.glb")
    out2 = os.path.join(os.path.dirname(__file__), "frontend", "dist", "models", "polar_ship.glb")
    create_gltf_standard_polar_ship(out1)
    if os.path.exists(os.path.dirname(out2)):
        create_gltf_standard_polar_ship(out2)
