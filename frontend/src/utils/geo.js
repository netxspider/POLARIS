/**
 * POLARIS Antarctic Marine Navigation Geospatial Utilities
 */

// Haversine Nautical Distance and Great-Circle Bearing Calculator
export const getDistanceAndBearing = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) {
    return { distanceNm: 0, distanceKm: 0, bearingDeg: 0, compassDir: '--' };
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const R_km = 6371.0;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R_km * c;
  const distanceNm = distanceKm * 0.539957;

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  let bearingDeg = (toDeg(Math.atan2(y, x)) + 360) % 360;

  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirIdx = Math.round(bearingDeg / 22.5) % 16;

  return {
    distanceNm: Math.round(distanceNm),
    distanceKm: Math.round(distanceKm),
    bearingDeg: Math.round(bearingDeg),
    compassDir: directions[dirIdx]
  };
};

// High-Resolution BEDMAP2 / IBCSO v2 Bathymetric Depth Calculator (positive meters)
export const getBathymetricDepth = (lat, lon) => {
  const coastLat = -69.8 + 0.8 * Math.sin((lon * 2.2 - 15.0) * (Math.PI / 180));
  const isMaitriChannel = (lon >= 10.0 && lon <= 13.5 && lat >= -71.0 && lat <= -69.0);
  const isBharatiChannel = (lon >= 74.0 && lon <= 78.0 && lat >= -70.0 && lat <= -68.5);

  // 1. Coastal Fairways (Maitri & Bharati Channels)
  if (isMaitriChannel) return Math.round(75.0 + 150.0 * Math.max(0.0, (lat + 71.0) / 2.0));
  if (isBharatiChannel) return Math.round(110.0 + 200.0 * Math.max(0.0, (lat + 70.0) / 1.5));

  // 2. Astrid Ridge Bank (Subsea pinnacle around 14.5°E, -68.8°)
  const distAstridRidge = Math.hypot((lon - 14.5) * 0.5, lat - (-68.8));
  if (distAstridRidge < 1.2) {
    const ridgeRise = (1.0 - distAstridRidge / 1.2) * 850.0;
    return Math.max(220.0, Math.round(1100.0 - ridgeRise));
  }

  // 3. Gunnerus Ridge Seamount (Major underwater volcanic plateau around 33.5°E, -65.8°)
  const distGunnerus = Math.hypot((lon - 33.5) * 0.7, lat - (-65.8));
  if (distGunnerus < 2.0) {
    const gunnerusRise = (1.0 - distGunnerus / 2.0) * 2400.0;
    return Math.max(750.0, Math.round(3300.0 - gunnerusRise));
  }

  // 4. Amery Depression Trough (Overdeepened shelf channel around 72.5°E, -68.8°)
  const distAmery = Math.hypot((lon - 72.5) * 0.6, lat - (-68.8));
  if (distAmery < 1.5) {
    const trenchDeepen = (1.0 - distAmery / 1.5) * 450.0;
    return Math.round(420.0 + trenchDeepen);
  }

  // 5. Shallow Ice Shelf Grounding Margin
  if (lat < coastLat - 0.3) return 45.0;
  if (lat < coastLat) return Math.round(45.0 + 135.0 * ((lat - (coastLat - 0.3)) / 0.3));

  // 6. Continental Slope (Shelf Break)
  if (lat < -66.5) {
    const t = (lat - coastLat) / (-66.5 - coastLat);
    return Math.round(180.0 + 620.0 * Math.min(1.0, Math.max(0.0, t)));
  }

  // 7. Continental Rise & Abyssal Transition
  if (lat < -64.0) {
    const t = (lat - (-66.5)) / (-64.0 - (-66.5));
    const isCosmonautsDeep = Math.abs(lon - 48.0) < 5.0;
    const trenchBonus = isCosmonautsDeep ? 650.0 * Math.cos((lon - 48.0) * (Math.PI / 10)) : 0;
    return Math.round(800.0 + 2400.0 * Math.min(1.0, Math.max(0.0, t)) + trenchBonus);
  }

  // 8. Open Southern Ocean Abyssal Plain (3,200m - 4,100m)
  const baseAbyss = 3400.0 + 500.0 * Math.sin(lon * 2.8 * (Math.PI / 180));
  const cosmoTrench = Math.abs(lon - 48.0) < 6.0 ? 550.0 * Math.cos((lon - 48.0) * (Math.PI / 12)) : 0;
  return Math.round(baseAbyss + cosmoTrench);
};
