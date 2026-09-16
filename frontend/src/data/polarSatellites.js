/**
 * Real Polar Earth Observation & Oceanographic Research Satellites
 * Active over the Antarctic Corridor (Maitri - Bharati - Prydz Bay):
 * 1. CryoSat-2 (ESA SIRAL Radar Altimeter - sea ice thickness & freeboard)
 * 2. ICESat-2 (NASA ATLAS Laser Altimeter - ice sheet elevation and sea ice profiling)
 * 3. Aqua / AMSR2 (NASA/JAXA Advanced Microwave Scanning Radiometer - sea-ice concentration)
 * 4. Landsat 9 (NASA/USGS OLI-2/TIRS-2 - polar optical & thermal infrared multispectral)
 */

export const POLAR_SATELLITES = [
  {
    noradId: 36508,
    name: 'CRYOSAT-2 🛰️',
    agency: 'ESA',
    sensor: 'SIRAL Radar Altimeter',
    role: 'Precision radar altimetry measuring polar ice shelf thickness and sea-ice freeboard',
    altitudeKm: 717,
    inclinationDeg: 92.00,
    periodMin: 99.2,
    color: '#39ff14',
    swathKm: 15,
    tleLine1: '1 36508U 10013A   26252.81250000  .00000085  00000+0  21000-4 0  9994',
    tleLine2: '2 36508  92.0040 140.2300 0014200 120.4500 239.7500 14.51245000865003'
  },
  {
    noradId: 43613,
    name: 'ICESAT-2 🛰️',
    agency: 'NASA',
    sensor: 'ATLAS Photon-Counting Lidar',
    role: 'High-resolution green laser profiling of ice sheet mass changes and sea ice roughness',
    altitudeKm: 496,
    inclinationDeg: 92.00,
    periodMin: 94.6,
    color: '#facc15',
    swathKm: 11,
    tleLine1: '1 43613U 18070A   26252.81250000  .00000210  00000+0  48000-4 0  9997',
    tleLine2: '2 43613  92.0020  75.1200 0012800  95.4000 264.8000 15.22500000421008'
  },
  {
    noradId: 27424,
    name: 'AQUA (AMSR-E/AMSR2) 🛰️',
    agency: 'NASA / JAXA',
    sensor: 'AMSR Passive Microwave',
    role: 'Global polar passive-microwave brightness temperatures for daily ice concentration grids',
    altitudeKm: 705,
    inclinationDeg: 98.20,
    periodMin: 98.8,
    color: '#ff007f',
    swathKm: 1450,
    tleLine1: '1 27424U 02022A   26252.81250000  .00000095  00000+0  28000-4 0  9991',
    tleLine2: '2 27424  98.2050 310.1500 0001420  70.1200 290.0100 14.57110000289005'
  },
  {
    noradId: 49260,
    name: 'LANDSAT 9 🛰️',
    agency: 'NASA / USGS',
    sensor: 'OLI-2 / TIRS-2',
    role: 'Multispectral and thermal infrared high-detail imaging of coastal fast ice and calving rifts',
    altitudeKm: 705,
    inclinationDeg: 98.20,
    periodMin: 98.9,
    color: '#fb923c',
    swathKm: 185,
    tleLine1: '1 49260U 21088A   26252.81250000  .00000115  00000+0  31000-4 0  9992',
    tleLine2: '2 49260  98.2010  45.6000 0001150  82.1000 278.0200 14.57150000256001'
  }
];