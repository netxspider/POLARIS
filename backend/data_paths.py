"""
POLARIS — Training Dataset Paths Configuration
==============================================
Replace every value marked  # <<< YOUR DATASET HERE >>>  with the absolute
path to your actual file before calling train_*() in any model file.

HOW TO USE
----------
1. Put your downloaded datasets anywhere on disk (external drive, cloud mount, etc.)
2. Edit the strings below to point at those locations.
3. In main.py set DEMO_MODE = False and TRAINING_MODE = True to trigger training.
4. Trained model weights are saved to WEIGHTS_DIR automatically.

DATA SOURCES (where to download each dataset)
---------------------------------------------
AMSR2 microwave brightness temperature:
    https://nsidc.org/data/au_si25  (NSIDC, free account required)
    → .h5 files, daily 25 km EASE-Grid2, channels: 18.7V, 18.7H, 36.5V, 89.0V

NSIDC Sea Ice Concentration ground truth (Bootstrap algorithm):
    https://nsidc.org/data/nsidc-0079
    → .bin / .nc files, 25 km SSMI/S, daily

National Ice Center (NIC) iceberg positions:
    https://www.natice.noaa.gov/products/weekly_products.html
    → .csv / .shp files, weekly tabular iceberg lat/lon + dimensions

BYU/NIC scatterometer iceberg tracking (for LSTM sequences):
    https://www.scp.byu.edu/data/iceberg/  (BYU free access)
    → .csv per-iceberg drift sequence files

ERA5 wind + current reanalysis (for LSTM training wind/current inputs):
    https://cds.climate.copernicus.eu/cdsapp  (Copernicus CDS, free account)
    → NetCDF (.nc): 10m u-wind, 10m v-wind, surface ocean current u/v

GEBCO 2023 Bathymetry (seabed depth):
    https://www.gebco.net/data_and_products/gridded_bathymetry_data/
    → .nc or .tif, global 15 arc-second resolution
"""

import os

# ---------------------------------------------------------------------------
# CHANGE THESE PATHS TO YOUR ACTUAL DATASET LOCATIONS
# ---------------------------------------------------------------------------

# ── CNN (Sea-Ice Risk Model) ────────────────────────────────────────────────

# Folder containing AMSR2 .h5 files (one per day, or subset for East Antarctic sector)
AMSR2_DATA_DIR = r"C:\YOUR_DATA\amsr2_brightness_temp"      # <<< YOUR DATASET HERE >>>

# NetCDF or .bin folder with NSIDC sea-ice concentration ground truth labels
NSIDC_SIC_DIR  = r"C:\YOUR_DATA\nsidc_sea_ice_concentration" # <<< YOUR DATASET HERE >>>

# ── Weights Directory ───────────────────────────────────────────────────────
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "models", "weights")

# Trained CNN weights — saved here after training, loaded from here at startup
CNN_WEIGHTS_PATH = os.path.join(WEIGHTS_DIR, "sea_ice_cnn.pt")

# ── LSTM (Iceberg Trajectory Model) ────────────────────────────────────────

# BYU/NIC Antarctic Iceberg Database (650 tracking CSVs, includes C-19, B-15, etc.)
ICEBERG_TRACK_DIR = os.path.join(
    os.path.dirname(__file__), "data", "nic_iceberg", "updated7_consol"
)
ICEBERG_TRACK_CSV = os.path.join(ICEBERG_TRACK_DIR, "c19.csv")  # Primary tabular berg

# ERA5 reanalysis NetCDF — used as wind/current input features for LSTM training
# Variables needed: u10, v10, uo (ocean u), vo (ocean v)
ERA5_WIND_NC = r"C:\YOUR_DATA\era5\era5_winds_southern_ocean.nc"           # <<< YOUR DATASET HERE >>>
ERA5_CURR_NC = r"C:\YOUR_DATA\era5\era5_currents_southern_ocean.nc"        # <<< YOUR DATASET HERE >>>

# Trained LSTM weights
LSTM_WEIGHTS_PATH = os.path.join(WEIGHTS_DIR, "iceberg_lstm.pt")

# ── Environmental Lookup (Bathymetry) ───────────────────────────────────────

# Official GEBCO / IBCSO v2 high-resolution Antarctic bathymetry (WGS84 GeoTIFF)
GEBCO_BATHYMETRY_TIF = os.path.join(
    os.path.dirname(__file__), "data", "gebco", "IBCSO_v2_bed_WGS84.tif"
)
# Pre-extracted fast-loading corridor grid (1034 x 6951 floats, [LAT_MIN, LAT_MAX] x [LON_MIN, LON_MAX])
GEBCO_CORRIDOR_NPY = os.path.join(
    os.path.dirname(__file__), "data", "gebco", "gebco_corridor_bathymetry.npy"
)
GEBCO_BATHYMETRY_NC = GEBCO_BATHYMETRY_TIF

# ── General ────────────────────────────────────────────────────────────────

# Set True to run training on startup (slow), False to load saved weights
TRAINING_MODE = False


def assert_paths_exist():
    """Call this at backend startup to catch missing dataset paths early."""
    required = {
        "AMSR2_DATA_DIR":       AMSR2_DATA_DIR,
        "NSIDC_SIC_DIR":        NSIDC_SIC_DIR,
        "ICEBERG_TRACK_CSV":    ICEBERG_TRACK_CSV,
        "ERA5_WIND_NC":         ERA5_WIND_NC,
        "ERA5_CURR_NC":         ERA5_CURR_NC,
        "GEBCO_BATHYMETRY_NC":  GEBCO_BATHYMETRY_NC,
    }
    missing = [name for name, path in required.items() if not os.path.exists(path)]
    if missing:
        print("[POLARIS] WARNING — the following dataset paths do not exist yet:")
        for name in missing:
            print(f"  {name} = {required[name]}")
        print("[POLARIS] Models will use synthetic/cached data until real paths are set.")
    return len(missing) == 0
