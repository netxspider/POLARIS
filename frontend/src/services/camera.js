import * as Cesium from 'cesium';

/**
 * Camera presets for Antarctic maritime & research operations:
 * - East Antarctic Corridor (Maitri to Bharati anchor route)
 * - Princess Astrid Coast / Maitri Station
 * - Prydz Bay / Larsemann Hills / Bharati Base
 * - High-orbital God's Eye Synoptic Polar View
 */
export const CAMERA_PRESETS = {
  polarCorridor: {
    destination: Cesium.Cartesian3.fromDegrees(44.0, -78.0, 4800000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-55),
      roll: 0.0,
    },
  },
  maitri: {
    destination: Cesium.Cartesian3.fromDegrees(11.73, -70.77, 18000),
    orientation: {
      heading: Cesium.Math.toRadians(15),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  bharati: {
    destination: Cesium.Cartesian3.fromDegrees(76.19, -69.41, 16000),
    orientation: {
      heading: Cesium.Math.toRadians(350),
      pitch: Cesium.Math.toRadians(-32),
      roll: 0.0,
    },
  },
  prydzBay: {
    destination: Cesium.Cartesian3.fromDegrees(74.5, -68.8, 65000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0.0,
    },
  },
  orbitalGodsEye: {
    destination: Cesium.Cartesian3.fromDegrees(44.0, -88.0, 16500000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-89.9),
      roll: 0.0,
    },
  }
};

/**
 * Fly the camera to a preset location with a smooth cubic in-out animation.
 */
export function flyToPreset(viewer, presetName, duration = 2.5) {
  if (!viewer || viewer.isDestroyed()) return;
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.cancelFlight?.();
  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Cinematic orbital fly-in to the East Antarctic Fairway on load.
 */
export function cinematicFlyIn(viewer) {
  if (!viewer || viewer.isDestroyed()) return;

  // High altitude polar synoptic overview
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(44.0, -88.0, 15000000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-89.9),
      roll: 0.0,
    },
  });

  // Cinematic swoop into operational theatre
  setTimeout(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(25.0, -72.0, 3200000),
      orientation: {
        heading: Cesium.Math.toRadians(12),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0.0,
      },
      duration: 3.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 400);
}

/**
 * Fly the camera smoothly to track/focus on the research vessel RV Polar Explorer
 * without plunging subsurface or through the globe.
 */
export function flyToShipCamera(viewer, shipEntity, options = {}) {
  if (!viewer || viewer.isDestroyed() || !shipEntity) return Promise.resolve(false);

  const duration = options.duration ?? 1.5;
  const rangeM = options.rangeM ?? 180.0;
  const pitchDeg = options.pitchDeg ?? -13.0;
  const headingDeg = options.headingDeg ?? 0.0;

  viewer.trackedEntity = undefined;
  viewer.camera.cancelFlight?.();

  return viewer.flyTo(shipEntity, {
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(headingDeg),
      Cesium.Math.toRadians(pitchDeg),
      rangeM
    ),
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Configure camera controller to prevent zooming through the globe, clipping subsurface,
 * or flinging into deep space when orbiting under entities.
 * Restricts minimum zoom distance, enables collision detection, sets maximum tilt angle
 * to prevent subterranean views, and enforces local/world space bounds.
 */
export function configureCameraCollisionPrevention(viewer, options = {}) {
  if (!viewer || viewer.isDestroyed()) return;

  const sscController = viewer.scene.screenSpaceCameraController;
  if (!sscController) return;

  // 1. Enable collision detection with the globe surface
  sscController.enableCollisionDetection = true;

  // 2. Minimum zoom distance above the surface so users cannot zoom into the center of the Earth
  sscController.minimumZoomDistance = options.minimumZoomDistance ?? 20.0;

  // 3. Maximum zoom distance to prevent losing sight of the Earth
  sscController.maximumZoomDistance = options.maximumZoomDistance ?? 35000000.0;

  // 4. Restrict camera tilt to prevent underground upside-down viewing.
  // Cesium's maximumTiltAngle specifies the maximum angle relative to the ellipsoid normal (Math.PI/2 = horizontal).
  // Restricting to 87.5 degrees keeps the camera above the horizon and completely prevents tilting beneath the surface/water.
  sscController.maximumTiltAngle = Cesium.Math.toRadians(87.5);

  // 5. Ensure globe depth test and ground clamping rules prevent underground artifacts
  viewer.scene.globe.depthTestAgainstTerrain = true;
  if (viewer.scene.globe.translucency) {
    viewer.scene.globe.translucency.enabled = false;
  }

  // 6. Restrict camera from plunging below minimum height or clipping under entities
  const minAltitude = options.minAltitudeM ?? 15.0; // Ocean surface is 0m; keep camera safely at least 15m above sea level
  const minTrackedRange = options.minTrackedRangeM ?? 25.0; // Minimum distance to tracked entity (e.g. ship)

  const onPreRender = () => {
    if (viewer.isDestroyed()) return;
    const camera = viewer.camera;
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const hasTransform = !Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY);

    if (hasTransform) {
      // Camera is in a local entity transform (e.g. trackedEntity / lookAtTransform)
      // In local East-North-Up frame:
      // - camera.position is in meters relative to the entity center
      // - local z is altitude relative to the entity
      const range = Cesium.Cartesian3.magnitude(camera.position);

      // Prevent zooming through/inside the ship
      if (range < minTrackedRange) {
        if (range > 0.001) {
          Cesium.Cartesian3.normalize(camera.position, camera.position);
          Cesium.Cartesian3.multiplyByScalar(camera.position, minTrackedRange, camera.position);
        } else {
          // If range collapsed to 0, restore safe offset
          camera.position.x = 0.0;
          camera.position.y = -minTrackedRange * 0.85;
          camera.position.z = minTrackedRange * 0.5;
        }
      }

      // Prevent moving/tilting UNDER the ship into the water/ground
      // Ensure local z is always above the ship waterline (z >= 15.0m)
      if (camera.position.z < 15.0) {
        camera.position.z = 15.0;
        // Recompute camera direction and up vectors to point cleanly towards entity
        Cesium.Cartesian3.negate(camera.position, camera.direction);
        Cesium.Cartesian3.normalize(camera.direction, camera.direction);
        const upRef = Math.abs(camera.direction.z) > 0.95 ? Cesium.Cartesian3.UNIT_Y : Cesium.Cartesian3.UNIT_Z;
        Cesium.Cartesian3.cross(camera.direction, upRef, camera.right);
        if (Cesium.Cartesian3.magnitudeSquared(camera.right) > 0.001) {
          Cesium.Cartesian3.normalize(camera.right, camera.right);
          Cesium.Cartesian3.cross(camera.right, camera.direction, camera.up);
          Cesium.Cartesian3.normalize(camera.up, camera.up);
        }
      }
    } else {
      // Camera is in world space (free camera)
      const carto = camera.positionCartographic;
      if (carto && carto.height < minAltitude) {
        carto.height = minAltitude;
        const safePos = Cesium.Cartographic.toCartesian(carto, ellipsoid);
        camera.position = safePos;
        // Stop any remaining zoom inertia so camera rests smoothly at the floor
        if (sscController._lastInertiaZoomMovement) {
          sscController._lastInertiaZoomMovement = undefined;
        }
      }
    }
  };

  const removePreRender = viewer.scene.preRender.addEventListener(onPreRender);

  return () => {
    if (!viewer.isDestroyed()) {
      removePreRender();
    }
  };
}

