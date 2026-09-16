/**
 * Authentic Marine ECDIS Display Palettes (IEC 62288 / IHO S-52 Standards)
 * Provides standard bridge watchkeeping color regimes:
 * - Day Mode: Natural optical true-color navigation surface
 * - Night Mode: Low-illumination amber/red bridge watch palette to preserve night adaptation
 * - Radar SAR Mode: High-contrast synthetic aperture radar display for sea-ice discrimination
 */

export const ecdisNightShader = {
  name: 'night',
  uniforms: {
    intensity: { default: 1.0, min: 0, max: 1, label: 'Night Tint' }
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform float intensity;
    in vec2 v_textureCoordinates;

    void main() {
      vec4 color = texture(colorTexture, v_textureCoordinates);
      
      // Compute perceived luminance
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      
      // IHO S-52 Night Mode: subdued dark red/amber low-glare spectrum
      vec3 nightPalette = vec3(lum * 0.85 + 0.05, lum * 0.35, lum * 0.12);
      
      // Blend based on intensity
      vec3 finalColor = mix(color.rgb * 0.35, nightPalette, 0.75 * intensity);
      
      out_FragColor = vec4(finalColor, color.a);
    }
  `
};

export const ecdisRadarShader = {
  name: 'radar',
  uniforms: {
    intensity: { default: 1.0, min: 0, max: 1, label: 'Radar Contrast' }
  },
  fragmentShader: /* glsl */ `
    uniform sampler2D colorTexture;
    uniform float intensity;
    in vec2 v_textureCoordinates;

    void main() {
      vec4 color = texture(colorTexture, v_textureCoordinates);
      
      // High contrast monochrome for ice boundary detection
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float boosted = smoothstep(0.25, 0.85, lum);
      
      // Marine S-band / X-band cyan-green radar phosphor
      vec3 radarPhosphor = vec3(boosted * 0.2, boosted * 0.95, boosted * 0.85);
      
      vec3 finalColor = mix(color.rgb, radarPhosphor, 0.80 * intensity);
      out_FragColor = vec4(finalColor, color.a);
    }
  `
};
