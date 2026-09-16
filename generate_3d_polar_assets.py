"""
Generates 3D GLB Models for:
1. Tabular Iceberg (iceberg_tabular.glb)
2. Pinnacled Iceberg (iceberg_pinnacle.glb)
3. Antarctic Nunatak / Coastal Mountain (mountain_massif.glb)
4. Coastal Glacier Tongue & Ice Shelf (glacier_shelf.glb)
"""

import json
import struct
import os
import math
import random

def save_glb(output_path, vertices, normals, colors, indices, model_name="Polar3DAsset"):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
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
    idx_offset = 0

    vert_offset = len(idx_bytes)
    vert_len = len(vert_bytes)
    norm_offset = vert_offset + vert_len
    norm_len = len(norm_bytes)
    col_offset = norm_offset + norm_len
    col_len = len(col_bytes)

    bin_data = idx_bytes + vert_bytes + norm_bytes + col_bytes
    total_bin_len = len(bin_data)

    gltf = {
        "asset": {"version": "2.0", "generator": "POLARIS 3D Asset Generator"},
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": model_name, "mesh": 0}],
        "meshes": [{
            "name": f"{model_name}Mesh",
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
            "name": f"{model_name}Material",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.4
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
            {"buffer": 0, "byteOffset": idx_offset, "byteLength": idx_len, "target": 34963},
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
    print(f"Generated: {output_path}")

def generate_tabular_iceberg(path):
    """Generates a massive 3D Tabular Iceberg with vertical sheer ice walls and snow top."""
    vertices, normals, colors, indices = [], [], [], []
    def add_quad(v1, v2, v3, v4, n, col):
        b = len(vertices) // 3
        for v in (v1, v2, v3, v4):
            vertices.extend(v); normals.extend(n); colors.extend(col)
        indices.extend([b, b+1, b+2, b, b+2, b+3])

    def add_tri(v1, v2, v3, n, col):
        b = len(vertices) // 3
        for v in (v1, v2, v3):
            vertices.extend(v); normals.extend(n); colors.extend(col)
        indices.extend([b, b+1, b+2])

    # Dimensions: 800m x 500m, height 50m above water
    ICE_TOP = [0.94, 0.98, 1.0, 1.0]
    ICE_WALL = [0.65, 0.85, 0.96, 1.0]
    ICE_BLUE_DEEP = [0.25, 0.65, 0.90, 1.0]

    # Jagged perimeter points
    n_pts = 16
    r_x, r_y = 400.0, 250.0
    top_ring = []
    bot_ring = []
    
    random.seed(42)
    for i in range(n_pts):
        angle = (2.0 * math.pi * i) / n_pts
        jitter_r = 1.0 + 0.18 * math.sin(angle * 5.0) + 0.12 * math.cos(angle * 3.0)
        px = r_x * math.cos(angle) * jitter_r
        py = r_y * math.sin(angle) * jitter_r
        pz_top = 45.0 + 8.0 * math.sin(angle * 4.0)
        top_ring.append([px, py, pz_top])
        bot_ring.append([px * 1.05, py * 1.05, 0.0])

    # Center top vertex for fan
    center_top = [0.0, 0.0, 52.0]

    # Top surface fan
    for i in range(n_pts):
        nxt = (i + 1) % n_pts
        add_tri(center_top, top_ring[i], top_ring[nxt], [0, 0, 1], ICE_TOP)

    # Vertical ice wall quads
    for i in range(n_pts):
        nxt = (i + 1) % n_pts
        t1, t2 = top_ring[i], top_ring[nxt]
        b1, b2 = bot_ring[i], bot_ring[nxt]
        # compute normal
        dx = t2[0] - t1[0]
        dy = t2[1] - t1[1]
        nx = dy
        ny = -dx
        nl = math.sqrt(nx*nx + ny*ny) or 1.0
        n = [nx/nl, ny/nl, 0.1]
        col = ICE_WALL if (i % 2 == 0) else ICE_BLUE_DEEP
        add_quad(b1, b2, t2, t1, n, col)

    save_glb(path, vertices, normals, colors, indices, "TabularIceberg")

def generate_pinnacled_iceberg(path):
    """Generates a sharp, multi-spire pinnacled iceberg."""
    vertices, normals, colors, indices = [], [], [], []
    def add_tri(v1, v2, v3, n, col):
        b = len(vertices) // 3
        for v in (v1, v2, v3):
            vertices.extend(v); normals.extend(n); colors.extend(col)
        indices.extend([b, b+1, b+2])

    ICE_SPIRE = [0.92, 0.98, 1.0, 1.0]
    ICE_BLUE = [0.45, 0.78, 0.95, 1.0]

    # 3 Spire peaks
    peaks = [
        [0.0, 0.0, 85.0],
        [-120.0, 60.0, 65.0],
        [90.0, -50.0, 55.0]
    ]

    base_pts = [
        [-250.0, -180.0, 0.0],
        [-180.0, 220.0, 0.0],
        [60.0, 240.0, 0.0],
        [240.0, 110.0, 0.0],
        [220.0, -140.0, 0.0],
        [0.0, -260.0, 0.0]
    ]

    for peak in peaks:
        for i in range(len(base_pts)):
            nxt = (i + 1) % len(base_pts)
            b1 = base_pts[i]
            b2 = base_pts[nxt]
            add_tri(peak, b1, b2, [0.3, 0.3, 0.8], ICE_SPIRE if peak[2] > 70 else ICE_BLUE)

    save_glb(path, vertices, normals, colors, indices, "PinnacleIceberg")

def generate_mountain_massif(path):
    """Generates a 3D Antarctic Nunatak / Mountain ridge rising above ice sheet."""
    vertices, normals, colors, indices = [], [], [], []
    def add_tri(v1, v2, v3, n, col):
        b = len(vertices) // 3
        for v in (v1, v2, v3):
            vertices.extend(v); normals.extend(n); colors.extend(col)
        indices.extend([b, b+1, b+2])

    ROCK_DARK = [0.28, 0.26, 0.25, 1.0]
    ROCK_BROWN = [0.42, 0.38, 0.35, 1.0]
    SNOW_WHITE = [0.95, 0.96, 0.98, 1.0]

    # Mountain ridge: 3 major high peaks
    ridge_peaks = [
        [-3000.0, 0.0, 1800.0],
        [0.0, 500.0, 2450.0],
        [2800.0, -300.0, 1950.0],
        [5000.0, 200.0, 1400.0]
    ]

    base_north = [
        [-5000.0, 4000.0, 100.0],
        [-2000.0, 4500.0, 150.0],
        [1000.0, 4800.0, 200.0],
        [4000.0, 4200.0, 120.0],
        [6500.0, 3800.0, 80.0]
    ]

    base_south = [
        [-5000.0, -4000.0, 100.0],
        [-2000.0, -4200.0, 150.0],
        [1000.0, -4500.0, 200.0],
        [4000.0, -4100.0, 120.0],
        [6500.0, -3500.0, 80.0]
    ]

    # Connect peaks along ridge
    for i in range(len(ridge_peaks) - 1):
        p1 = ridge_peaks[i]
        p2 = ridge_peaks[i + 1]
        bn1 = base_north[i]
        bn2 = base_north[i + 1]
        bs1 = base_south[i]
        bs2 = base_south[i + 1]

        # North face (rock + snow couloir)
        add_tri(p1, bn1, bn2, [0, 0.8, 0.5], SNOW_WHITE)
        add_tri(p1, bn2, p2, [0, 0.8, 0.5], ROCK_DARK)

        # South face (exposed craggy granite)
        add_tri(p1, bs2, bs1, [0, -0.8, 0.5], ROCK_BROWN)
        add_tri(p1, p2, bs2, [0, -0.8, 0.5], ROCK_DARK)

    save_glb(path, vertices, normals, colors, indices, "AntarcticMountainMassif")

def generate_glacier_shelf(path):
    """Generates an Antarctic 3D Ice Shelf Calving Front (Amery / Fimbul Ice Shelf)."""
    vertices, normals, colors, indices = [], [], [], []
    def add_quad(v1, v2, v3, v4, n, col):
        b = len(vertices) // 3
        for v in (v1, v2, v3, v4):
            vertices.extend(v); normals.extend(n); colors.extend(col)
        indices.extend([b, b+1, b+2, b, b+2, b+3])

    GLACIER_TOP = [0.96, 0.98, 1.0, 1.0]
    GLACIER_CLIFF = [0.55, 0.80, 0.95, 1.0]
    GLACIER_CREVASSE = [0.18, 0.55, 0.88, 1.0]

    # Ice shelf wall: 10km wide, 3km inland, 60m cliff height
    dx = 1000.0
    for seg in range(10):
        x1 = (seg - 5) * dx
        x2 = (seg - 4) * dx
        y_front1 = 100.0 * math.sin(seg * 0.8)
        y_front2 = 100.0 * math.sin((seg + 1) * 0.8)
        y_back = -3000.0
        h1 = 55.0 + 8.0 * math.cos(seg * 1.2)
        h2 = 55.0 + 8.0 * math.cos((seg + 1) * 1.2)

        # Front cliff face
        v_bl = [x1, y_front1, 0.0]
        v_br = [x2, y_front2, 0.0]
        v_tr = [x2, y_front2, h2]
        v_tl = [x1, y_front1, h1]
        col = GLACIER_CLIFF if seg % 2 == 0 else GLACIER_CREVASSE
        add_quad(v_bl, v_br, v_tr, v_tl, [0, 1, 0], col)

        # Top surface plateau
        v_tb_l = [x1, y_back, h1 + 40.0]
        v_tb_r = [x2, y_back, h2 + 40.0]
        add_quad(v_tl, v_tr, v_tb_r, v_tb_l, [0, 0, 1], GLACIER_TOP)

    save_glb(path, vertices, normals, colors, indices, "GlacierIceShelf")

if __name__ == "__main__":
    base_dir = os.path.join(os.path.dirname(__file__), "frontend", "public", "models")
    generate_tabular_iceberg(os.path.join(base_dir, "iceberg_tabular.glb"))
    generate_pinnacled_iceberg(os.path.join(base_dir, "iceberg_pinnacle.glb"))
    generate_mountain_massif(os.path.join(base_dir, "mountain_massif.glb"))
    generate_glacier_shelf(os.path.join(base_dir, "glacier_shelf.glb"))
