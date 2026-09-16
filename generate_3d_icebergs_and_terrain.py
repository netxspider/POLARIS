"""
POLARIS High-Fidelity 3D Antarctic Iceberg, Mountain, and Glacier Mesh Generator.
Conforms strictly to glTF 2.0 Specification & Cesium Engine 3D Coordinate Conventions:
- +Y is UP (Zenith, height above sea level)
- +Z is FORWARD (Heading along drift trajectory)
- +X is RIGHT (Starboard / Transverse width)
"""

import json
import struct
import os
import math
import random

def save_glb(output_paths, vertices, normals, colors, indices, model_name="Polar3DAsset", roughness=0.32, metallic=0.06):
    for output_path in output_paths:
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
        "asset": {"version": "2.0", "generator": "POLARIS High-Fidelity glTF 2.0 Generator"},
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
                "metallicFactor": metallic,
                "roughnessFactor": roughness
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

    for output_path in output_paths:
        with open(output_path, 'wb') as f:
            f.write(header)
            f.write(chunk0_header)
            f.write(json_bytes)
            f.write(chunk1_header)
            f.write(bin_data)
        print(f"Generated: {output_path} ({os.path.getsize(output_path)} bytes)")

def generate_tabular_iceberg(paths):
    """
    Generates a massive, multi-tiered Antarctic Tabular Iceberg (e.g. C-19 / A-68 style).
    Real world geographic scale:
      - Length along Z: 10,000 meters
      - Width along X: 6,500 meters
      - Freeboard height along +Y: +45 meters sheer cliff
      - Waterline: 0 meters
      - Submerged Keel: -120 meters
    """
    vertices, normals, colors, indices = [], [], [], []

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
        add_tri(v1, v2, v3, col, n)
        add_tri(v1, v3, v4, col, n)

    # Color Palette for Antarctic Tabular Ice
    SNOW_PLATEAU = [0.97, 0.98, 1.0, 1.0]          # Pure wind-packed snow
    SNOW_SLOPE = [0.88, 0.94, 0.99, 1.0]            # Shaded snow drifts
    ICE_CLIFF_SUN = [0.75, 0.90, 0.98, 1.0]         # Sunlit sheer calved ice face
    ICE_CLIFF_SHADE = [0.38, 0.68, 0.92, 1.0]       # Shaded glacial blue face
    ICE_FISSURE = [0.18, 0.52, 0.82, 1.0]           # Deep structural ice fissure
    WATERLINE_NOTCH = [0.25, 0.72, 0.88, 1.0]       # Wave-cut turquoise ice notch
    SUBMERGED_KEEL = [0.12, 0.38, 0.65, 1.0]        # Submerged deep keel

    num_pts = 32
    rx, rz = 3200.0, 5000.0
    top_rim = []
    mid_terrace = []
    waterline_rim = []
    keel_rim = []

    random.seed(101)
    for i in range(num_pts):
        ang = (2.0 * math.pi * i) / num_pts
        cos_a = math.cos(ang)
        sin_a = math.sin(ang)
        
        px = rx * math.copysign(abs(cos_a)**0.7, cos_a) * (1.0 + 0.08 * math.sin(ang * 5.0) + 0.04 * math.cos(ang * 9.0))
        pz = rz * math.copysign(abs(sin_a)**0.7, sin_a) * (1.0 + 0.06 * math.cos(ang * 4.0) + 0.05 * math.sin(ang * 8.0))
        
        y_top = 42.0 + 5.0 * math.sin(ang * 3.0) + 3.0 * math.cos(ang * 7.0)
        y_terr = 22.0 + 3.0 * math.cos(ang * 4.0)

        top_rim.append([px, y_top, pz])
        mid_terrace.append([px * 1.015, y_terr, pz * 1.015])
        waterline_rim.append([px * 1.035, 0.0, pz * 1.035])
        keel_rim.append([px * 0.92, -110.0, pz * 0.92])

    # 1. Upper Snow Plateau (Subdivided grid with sastrugi snow drifts)
    center_top = [0.0, 48.0, 0.0]
    for i in range(num_pts):
        nxt = (i + 1) % num_pts
        col = SNOW_PLATEAU if (i % 2 == 0) else SNOW_SLOPE
        add_tri(center_top, top_rim[i], top_rim[nxt], col, [0.0, 1.0, 0.0])

    # 2. Upper Calved Ice Face (from Plateau down to Terrace)
    for i in range(num_pts):
        nxt = (i + 1) % num_pts
        t1, t2 = top_rim[i], top_rim[nxt]
        m1, m2 = mid_terrace[i], mid_terrace[nxt]
        col = ICE_CLIFF_SUN if (i % 3 != 0) else ICE_FISSURE
        add_quad(m1, m2, t2, t1, col)

    # 3. Lower Calved Vertical Cliff (from Terrace down to Waterline)
    for i in range(num_pts):
        nxt = (i + 1) % num_pts
        m1, m2 = mid_terrace[i], mid_terrace[nxt]
        w1, w2 = waterline_rim[i], waterline_rim[nxt]
        col = ICE_CLIFF_SHADE if (i % 2 == 0) else ICE_CLIFF_SUN
        add_quad(w1, w2, m2, m1, col)

    # 4. Wave-cut Waterline Erosion Notch
    notch_rim = []
    for i in range(num_pts):
        notch_rim.append([waterline_rim[i][0] * 0.98, -8.0, waterline_rim[i][2] * 0.98])

    for i in range(num_pts):
        nxt = (i + 1) % num_pts
        add_quad(notch_rim[i], notch_rim[nxt], waterline_rim[nxt], waterline_rim[i], WATERLINE_NOTCH)

    # 5. Massive Submerged Keel (down to -110m)
    for i in range(num_pts):
        nxt = (i + 1) % num_pts
        add_quad(keel_rim[i], keel_rim[nxt], notch_rim[nxt], notch_rim[i], SUBMERGED_KEEL)

    # 6. Bottom Keel Cap
    center_keel = [0.0, -125.0, 0.0]
    for i in range(num_pts):
        nxt = (i + 1) % num_pts
        add_tri(center_keel, keel_rim[nxt], keel_rim[i], SUBMERGED_KEEL, [0.0, -1.0, 0.0])

    save_glb(paths, vertices, normals, colors, indices, "AntarcticTabularIceberg", roughness=0.25, metallic=0.08)

def generate_pinnacled_iceberg(paths):
    """
    Generates a dramatic multi-spire Pinnacled / Cathedral Iceberg.
    Real world geographic scale:
      - Length along Z: 5,000 meters
      - Width along X: 4,000 meters
      - Spire Height along +Y: up to +110 meters above sea level
      - Waterline: 0 meters
      - Keel: -90 meters
    """
    vertices, normals, colors, indices = [], [], [], []

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
        add_tri(v1, v2, v3, col, n)
        add_tri(v1, v3, v4, col, n)

    SPIRE_PEAK = [0.98, 0.99, 1.0, 1.0]          # Needle spire sun glint
    SPIRE_AZURE = [0.55, 0.85, 0.98, 1.0]        # Crystalline ice wall
    SPIRE_DEEP = [0.22, 0.58, 0.88, 1.0]         # Deep crevasse shadow
    SPIRE_BASE = [0.15, 0.42, 0.75, 1.0]         # Submerged turquoise foot

    spires = [
        [0.0, 108.0, 200.0],         # Primary cathedral spire
        [-900.0, 85.0, -800.0],      # Western horn
        [1100.0, 72.0, -300.0],      # Eastern crag
        [-400.0, 65.0, 1200.0],      # Forward fang
        [600.0, 58.0, 1400.0]        # Southeast tower
    ]

    base_pts = [
        [-1800.0, 0.0, -1600.0],
        [-1200.0, 0.0, -2200.0],
        [400.0, 0.0, -2300.0],
        [1800.0, 0.0, -1400.0],
        [2200.0, 0.0, 200.0],
        [1600.0, 0.0, 1800.0],
        [200.0, 0.0, 2400.0],
        [-1400.0, 0.0, 2100.0],
        [-2200.0, 0.0, 400.0]
    ]

    for s_idx, spire in enumerate(spires):
        col_main = SPIRE_PEAK if s_idx == 0 else SPIRE_AZURE
        col_sec = SPIRE_DEEP if s_idx % 2 == 1 else SPIRE_AZURE
        
        for i in range(len(base_pts)):
            nxt = (i + 1) % len(base_pts)
            b1 = base_pts[i]
            b2 = base_pts[nxt]
            
            mid_ridge = [(b1[0] + b2[0] + spire[0]) / 3.0, spire[1] * 0.45, (b1[2] + b2[2] + spire[2]) / 3.0]
            add_tri(spire, b1, mid_ridge, col_main)
            add_tri(spire, mid_ridge, b2, col_sec)

    keel_pts = [[p[0] * 0.85, -80.0, p[2] * 0.85] for p in base_pts]
    for i in range(len(base_pts)):
        nxt = (i + 1) % len(base_pts)
        add_quad(keel_pts[i], keel_pts[nxt], base_pts[nxt], base_pts[i], SPIRE_BASE)

    center_keel = [0.0, -95.0, 0.0]
    for i in range(len(base_pts)):
        nxt = (i + 1) % len(base_pts)
        add_tri(center_keel, keel_pts[nxt], keel_pts[i], SPIRE_BASE, [0.0, -1.0, 0.0])

    save_glb(paths, vertices, normals, colors, indices, "AntarcticPinnacledIceberg", roughness=0.22, metallic=0.10)

def generate_mountain_massif(paths):
    """
    Generates an Antarctic Coastal Massif / Nunatak Ridge.
    Real world geographic scale:
      - Length along Z: 24,000 meters
      - Width along X: 14,000 meters
      - Peak Height along +Y: +1,150 meters
    """
    vertices, normals, colors, indices = [], [], [], []

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

    ROCK_BASALT = [0.18, 0.20, 0.24, 1.0]        # Dark gneiss / basalt nunatak rock
    SNOW_GLACIER = [0.94, 0.96, 0.99, 1.0]       # Permanent summit glacier ice
    SCREE_SLOPE = [0.35, 0.38, 0.42, 1.0]        # Moraine rock debris

    peaks = [
        [-3500.0, 920.0, -2800.0],
        [-800.0, 1150.0, 400.0],
        [2400.0, 1040.0, -1200.0],
        [5200.0, 840.0, 2200.0]
    ]

    base_pts = [
        [-7000.0, 0.0, -5000.0],
        [-4500.0, 0.0, 4500.0],
        [0.0, 0.0, 6000.0],
        [5500.0, 0.0, 4800.0],
        [7500.0, 0.0, -3500.0],
        [2500.0, 0.0, -6000.0],
        [-2500.0, 0.0, -6500.0]
    ]

    for p_idx, peak in enumerate(peaks):
        col_peak = SNOW_GLACIER if p_idx % 2 == 1 else ROCK_BASALT
        for i in range(len(base_pts)):
            nxt = (i + 1) % len(base_pts)
            b1 = base_pts[i]
            b2 = base_pts[nxt]
            
            mid = [(b1[0] + b2[0] + peak[0]) / 3.0, peak[1] * 0.4, (b1[2] + b2[2] + peak[2]) / 3.0]
            add_tri(peak, b1, mid, col_peak)
            add_tri(peak, mid, b2, SCREE_SLOPE)

    save_glb(paths, vertices, normals, colors, indices, "AntarcticMountainMassif", roughness=0.65, metallic=0.04)

def generate_glacier_shelf(paths):
    """
    Generates an Antarctic Calving Glacier Shelf / Ice Tongue.
    Real world geographic scale:
      - Length along Z: 32,000 meters
      - Width along X: 20,000 meters
      - Calving Wall Height along +Y: +52 meters
    """
    vertices, normals, colors, indices = [], [], [], []

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
        add_tri(v1, v2, v3, col, n)
        add_tri(v1, v3, v4, col, n)

    GLACIER_SURFACE = [0.95, 0.98, 1.0, 1.0]
    GLACIER_WALL = [0.35, 0.72, 0.94, 1.0]
    GLACIER_CREVASSE = [0.18, 0.48, 0.78, 1.0]

    n_cols = 16
    width = 18000.0
    front_top = []
    front_bot = []
    back_top = []

    for i in range(n_cols):
        x = -width / 2.0 + (width / (n_cols - 1)) * i
        z_front = 2000.0 + 600.0 * math.sin(i * 0.9)
        z_back = -14000.0
        y_top = 48.0 + 6.0 * math.cos(i * 0.6)

        front_top.append([x, y_top, z_front])
        front_bot.append([x, 0.0, z_front])
        back_top.append([x, y_top + 120.0, z_back])

    for i in range(n_cols - 1):
        ft1, ft2 = front_top[i], front_top[i + 1]
        bt1, bt2 = back_top[i], back_top[i + 1]
        col = GLACIER_SURFACE if i % 2 == 0 else GLACIER_CREVASSE
        add_quad(bt1, bt2, ft2, ft1, col, [0.0, 1.0, 0.0])

    for i in range(n_cols - 1):
        ft1, ft2 = front_top[i], front_top[i + 1]
        fb1, fb2 = front_bot[i], front_bot[i + 1]
        add_quad(fb1, fb2, ft2, ft1, GLACIER_WALL, [0.0, 0.0, 1.0])

    save_glb(paths, vertices, normals, colors, indices, "AntarcticGlacierShelf", roughness=0.28, metallic=0.06)

if __name__ == "__main__":
    base_dirs = [
        "c:/Users/indla/OneDrive/Desktop/Polaris/frontend/public/models",
        "c:/Users/indla/OneDrive/Desktop/Polaris/frontend/dist/models"
    ]
    
    generate_tabular_iceberg([f"{d}/iceberg_tabular.glb" for d in base_dirs])
    generate_pinnacled_iceberg([f"{d}/iceberg_pinnacle.glb" for d in base_dirs])
    generate_mountain_massif([f"{d}/mountain_massif.glb" for d in base_dirs])
    generate_glacier_shelf([f"{d}/glacier_shelf.glb" for d in base_dirs])
    print("ALL REALISTIC GEOMETRIC 3D ASSETS REGENERATED SUCCESSFULLY!")

