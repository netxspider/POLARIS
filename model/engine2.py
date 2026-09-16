"""Engine 2: official USNIC iceberg ingestion and XGBoost drift training.

Importing this module is side-effect free. Training is explicit so the same
file can run in Colab or locally without mounting Drive automatically.
"""
from __future__ import annotations

import argparse
import io
import os
from pathlib import Path
from typing import Any, Dict, Optional

import joblib
import numpy as np
import pandas as pd
import requests
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

USNIC_CSV_URL = "https://usicecenter.gov/File/DownloadCurrent?pId=134"
FEATURE_COLS = ["lat", "lon", "length_km", "width_km", "uo", "vo", "curr_speed", "u10", "v10", "wind_speed", "thetao", "depth_m", "coriolis_f"]
TARGET_COLS = ["target_delta_lat", "target_delta_lon"]


def model_dir() -> Path:
    return Path(__file__).resolve().parent


def normalize_usnic_csv(frame: pd.DataFrame) -> pd.DataFrame:
    aliases = {"Iceberg": "iceberg_id", "Latitude": "lat", "Longitude": "lon", "Length (NM)": "length_nm", "Width (NM)": "width_nm", "Area (sqNM)": "area_sq_nm", "Area (sqKM)": "area_sq_km", "Last Update": "last_update"}
    frame = frame.rename(columns={key: value for key, value in aliases.items() if key in frame.columns}).copy()
    required = {"iceberg_id", "lat", "lon"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"USNIC CSV missing columns: {sorted(missing)}")
    for column in ("lat", "lon", "length_nm", "width_nm", "area_sq_nm", "area_sq_km"):
        if column in frame:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["iceberg_id"] = frame["iceberg_id"].astype(str).str.strip()
    frame = frame.dropna(subset=["iceberg_id", "lat", "lon"])
    return frame[frame["lat"].between(-90, -50) & frame["lon"].between(-180, 180)].drop_duplicates("iceberg_id").reset_index(drop=True)


def download_latest_usnic_icebergs(output_path: Optional[os.PathLike[str] | str] = None, url: str = USNIC_CSV_URL, timeout: int = 30) -> pd.DataFrame:
    """Download official USNIC CSV, replacing local data only after validation."""
    output = Path(output_path or (model_dir() / "AntarcticIcebergs_latest.csv"))
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        candidate = normalize_usnic_csv(pd.read_csv(io.BytesIO(response.content), encoding="utf-8-sig"))
        if candidate.empty:
            raise ValueError("USNIC response contained no valid records")
        output.parent.mkdir(parents=True, exist_ok=True)
        candidate.to_csv(output, index=False)
        return candidate
    except Exception as exc:
        candidates = [output, *sorted(model_dir().glob("AntarcticIcebergs_*.csv"), reverse=True)]
        for candidate_path in candidates:
            if candidate_path.exists():
                return normalize_usnic_csv(pd.read_csv(candidate_path))
        raise RuntimeError(f"Unable to download or locate a valid USNIC CSV: {exc}") from exc


def _gpu_params() -> Dict[str, Any]:
    try:
        import torch
        gpu = bool(torch.cuda.is_available())
    except Exception:
        gpu = False
    return {"tree_method": "hist", "device": "cuda" if gpu else "cpu"}


def train_models(training_csv: os.PathLike[str] | str, output_dir: Optional[os.PathLike[str] | str] = None, random_state: int = 42) -> Dict[str, float]:
    """Train and save latitude/longitude XGBoost drift regressors."""
    output = Path(output_dir or model_dir())
    frame = pd.read_csv(training_csv)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="coerce", utc=True)
    frame = frame.dropna(subset=FEATURE_COLS + TARGET_COLS + ["iceberg_id"])
    if frame["iceberg_id"].nunique() < 2:
        raise ValueError("Training requires at least two iceberg groups")
    split = GroupShuffleSplit(n_splits=1, train_size=0.8, random_state=random_state)
    train_idx, validation_idx = next(split.split(frame, groups=frame["iceberg_id"]))
    train, validation = frame.iloc[train_idx], frame.iloc[validation_idx]
    params = {**_gpu_params(), "n_estimators": 800, "max_depth": 7, "learning_rate": 0.025, "subsample": 0.85, "colsample_bytree": 0.85, "min_child_weight": 5, "reg_alpha": 0.2, "reg_lambda": 1.5, "random_state": random_state, "early_stopping_rounds": 40}
    metrics = {}
    for target, suffix in zip(TARGET_COLS, ("lat", "lon")):
        model = xgb.XGBRegressor(**params)
        model.fit(train[FEATURE_COLS], train[target], eval_set=[(validation[FEATURE_COLS], validation[target])], verbose=False)
        prediction = model.predict(validation[FEATURE_COLS])
        metrics[f"{suffix}_r2"] = float(r2_score(validation[target], prediction))
        metrics[f"{suffix}_mae"] = float(mean_absolute_error(validation[target], prediction))
        joblib.dump(model, output / f"engine2_drift_{suffix}_xgb.pkl")
    return metrics


def predict_trajectory(latitude: float, longitude: float, length_nm: float, width_nm: float, environment: pd.DataFrame, model_directory: Optional[os.PathLike[str] | str] = None) -> list[dict[str, float]]:
    """Predict a six-hourly 72-hour trajectory from saved Engine 2 models."""
    directory = Path(model_directory or model_dir())
    lat_model = joblib.load(directory / "engine2_drift_lat_xgb.pkl")
    lon_model = joblib.load(directory / "engine2_drift_lon_xgb.pkl")
    current_lat, current_lon = float(latitude), float(longitude)
    result = []
    for hours in range(6, 73, 6):
        env = environment.iloc[min(hours // 6 - 1, len(environment) - 1)]
        row = pd.DataFrame([{"lat": current_lat, "lon": current_lon, "length_km": length_nm * 1.852, "width_km": width_nm * 1.852, "uo": env.uo, "vo": env.vo, "curr_speed": np.hypot(env.uo, env.vo), "u10": env.u10, "v10": env.v10, "wind_speed": np.hypot(env.u10, env.v10), "thetao": env.thetao, "depth_m": env.depth_m, "coriolis_f": 2.0 * 7.2921e-5 * np.sin(np.radians(current_lat))}], columns=FEATURE_COLS)
        current_lat += float(lat_model.predict(row)[0]) / 4.0
        current_lon += float(lon_model.predict(row)[0]) / 4.0
        result.append({"lat": current_lat, "lon": current_lon, "hours": hours})
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--training-csv", required=True)
    parser.add_argument("--output-dir", default=str(model_dir()))
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    latest = download_latest_usnic_icebergs(Path(args.output_dir) / "AntarcticIcebergs_latest.csv")
    print(f"USNIC records: {len(latest)}")
    if not args.download_only:
        print(train_models(args.training_csv, args.output_dir))


if __name__ == "__main__":
    main()
