"""Engine 1: ConvLSTM sea-ice concentration forecasting.

The module is safe to import from the API. Training is explicit through
``train_model`` or the CLI and automatically uses a Colab CUDA GPU when one
is available.
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset


class ConvLSTMCell(nn.Module):
    def __init__(self, in_channels: int, hidden_channels: int, kernel_size: int = 3):
        super().__init__()
        self.hidden_channels = hidden_channels
        self.conv = nn.Conv2d(in_channels + hidden_channels, 4 * hidden_channels, kernel_size, padding=kernel_size // 2, bias=False)
        self.norm = nn.GroupNorm(4, 4 * hidden_channels)

    def forward(self, x, state):
        h_prev, c_prev = state
        gates = self.norm(self.conv(torch.cat([x, h_prev], dim=1)))
        i, f, o, g = torch.split(gates, self.hidden_channels, dim=1)
        c_next = torch.sigmoid(f) * c_prev + torch.sigmoid(i) * torch.tanh(g)
        return torch.sigmoid(o) * torch.tanh(c_next), c_next


class PolarSeaIceConvLSTM(nn.Module):
    def __init__(self, in_channels: int = 6, hidden_dim: int = 48, out_timesteps: int = 3):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.out_timesteps = out_timesteps
        self.enc1 = ConvLSTMCell(in_channels, hidden_dim)
        self.enc2 = ConvLSTMCell(hidden_dim, hidden_dim)
        self.dec1 = ConvLSTMCell(hidden_dim, hidden_dim)
        self.dec2 = ConvLSTMCell(hidden_dim, hidden_dim)
        self.head = nn.Sequential(nn.Conv2d(hidden_dim, 32, 3, padding=1), nn.LeakyReLU(0.1), nn.Conv2d(32, 1, 1), nn.Sigmoid())

    def forward(self, x):
        batch, _, _, height, width = x.shape
        device = x.device
        h1 = torch.zeros(batch, self.hidden_dim, height, width, device=device)
        c1 = torch.zeros_like(h1)
        h2 = torch.zeros_like(h1)
        c2 = torch.zeros_like(h1)
        for time in range(x.shape[1]):
            h1, c1 = self.enc1(x[:, time], (h1, c1))
            h2, c2 = self.enc2(h1, (h2, c2))
        current = h2
        outputs = []
        for _ in range(self.out_timesteps):
            h1, c1 = self.dec1(current, (h1, c1))
            h2, c2 = self.dec2(h1, (h2, c2))
            current = h2
            outputs.append(self.head(current))
        return torch.stack(outputs, dim=1)


def train_model(dataset_path: str, checkpoint_path: str, epochs: int = 30, batch_size: int = 8) -> Path:
    """Train Engine 1 using CUDA in Colab when available, otherwise CPU."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    data = np.load(dataset_path)
    x = torch.from_numpy(data["X"]).float()
    y = torch.from_numpy(data["Y"]).float()
    split = max(1, int(len(x) * 0.75))
    loader = DataLoader(TensorDataset(x[:split], y[:split]), batch_size=batch_size, shuffle=True, pin_memory=device.type == "cuda")
    model = PolarSeaIceConvLSTM(in_channels=x.shape[2], out_timesteps=y.shape[1]).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.MSELoss()
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    for epoch in range(epochs):
        model.train()
        for batch_x, batch_y in loader:
            batch_x, batch_y = batch_x.to(device, non_blocking=True), batch_y.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                loss = loss_fn(model(batch_x), batch_y)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        print(f"epoch={epoch + 1}/{epochs} loss={loss.item():.6f} device={device}")
    output = Path(checkpoint_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model_state": model.cpu().state_dict(), "epochs": epochs}, output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--checkpoint", default=str(Path(__file__).with_name("best_seaice_convlstm.pth")))
    parser.add_argument("--epochs", type=int, default=30)
    args = parser.parse_args()
    print(train_model(args.dataset, args.checkpoint, args.epochs))
