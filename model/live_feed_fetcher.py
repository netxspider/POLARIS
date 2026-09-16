import os
import requests
import pandas as pd
from datetime import datetime

CACHE_DIR = "./live_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

# 1. LIVE ICEBERG DATABASE (USNIC DAILY ACTIVE BERGS)
def fetch_live_usnic_icebergs(lat_min=-80.0, lat_max=-50.0, lon_min=0.0, lon_max=90.0):
    """
    Fetches the active Antarctic iceberg positions from the US National Ice Center.
    Falls back to latest cached file if connectivity is limited at sea.
    """
    url = "https://usicecenter.gov/File/DownloadCurrentIcebergCsv"
    target_csv = os.path.join(CACHE_DIR, "live_icebergs.csv")
    
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            with open(target_csv, "wb") as f:
                f.write(resp.content)
            print("Successfully updated live USNIC Iceberg database.")
    except Exception as e:
        print(f"Offline / connection failure: Using cached iceberg data. ({e})")

    if not os.path.exists(target_csv):
        return {}

    df = pd.read_csv(target_csv)
    df.columns = [c.lower().strip() for c in df.columns]

    # Map typical USNIC columns: iceberg, latitude, longitude
    lat_col = [c for c in df.columns if "lat" in c][0]
    lon_col = [c for c in df.columns if "lon" in c][0]
    id_col = [c for c in df.columns if "iceberg" in c or "name" in c or "id" in c][0]

    # Filter to Indian Antarctic Transit Sector
    active_corridor_bergs = {}
    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
            if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
                b_id = str(row[id_col])
                active_corridor_bergs[b_id] = (lat, lon)
        except (ValueError, TypeError):
            continue

    print(f"Active icebergs detected in corridor: {len(active_corridor_bergs)}")
    return active_corridor_bergs

# 2. LIVE SEA-ICE OBSERVATION (OSI-SAF NRT THREDDS / FTP)
def fetch_latest_osisaf_nrt(target_date=None):
    """
    Downloads the daily operational OSI-SAF Southern Ocean Near-Real-Time NetCDF (OSI-401-d).
    """
    if target_date is None:
        target_date = datetime.utcnow().date()

    date_str = target_date.strftime("%Y%m%d")
    filename = f"ice_conc_sh_polstere-100_multi_{date_str}1200.nc"
    target_path = os.path.join(CACHE_DIR, filename)

    if os.path.exists(target_path):
        return target_path

    # Public Copernicus / OSI-SAF HTTP gateway
    base_url = f"https://osisaf-hl.met.no/thredds/fileServer/osisaf/met.no/ice/conc/{target_date.year}/{target_date.month:02d}/{filename}"
    try:
        print(f"Fetching latest satellite ice observation ({date_str})...")
        r = requests.get(base_url, timeout=30, stream=True)
        if r.status_code == 200:
            with open(target_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            print("OSI-SAF observation downloaded.")
            return target_path
    except Exception as e:
        print(f"Satellite NRT download unavailable ({e}). Defaulting to last known state.")
    return None