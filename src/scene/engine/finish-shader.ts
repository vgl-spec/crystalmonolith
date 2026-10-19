// The "finish" pass: the last look applied to the whole frame before tone mapping. One shader keeps
// the cost to a single full-screen read per pixel for chromatic aberration, the project-open
// glitch, the return flash, film grain and the vignette.
export const FINISH_SHADER = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    /** Radial colour fringing, 0 = none, 1 = strong (the reference's descent fringes). */
    uAberration: { value: 0 },
    /** Multiplicative film grain amplitude. */
    uGrain: { value: 0 },
    uVignette: { value: 0.55 },
    /** Full-screen flash mix, 0..1. */
    uFlash: { value: 0 },
    uFlashColor: { value: [0.85, 1.6, 1.9] },
    /** Blocky displacement plus RGB split, 0..1. */
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uGlitch;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // Spectral fringe: R, G and B are sampled at different points along the aberration vector and
    // blended across several taps, so the fringe is a smooth rainbow instead of three ghosts.
    const int FRINGE_TAPS = 7;
    vec3 sampleFringed(vec2 uv, vec2 offset) {
      vec3 sum = vec3(0.0);
      vec3 weight = vec3(0.0);
      for (int i = 0; i < FRINGE_TAPS; i++) {
        float t = float(i) / float(FRINGE_TAPS - 1);
        vec3 w = vec3(clamp(1.0 - 2.0 * t, 0.0, 1.0), 1.0 - abs(2.0 * t - 1.0), clamp(2.0 * t - 1.0, 0.0, 1.0));
        sum += texture2D(tDiffuse, uv + offset * (t - 0.5) * 2.0).rgb * w;
        weight += w;
      }
      return sum / weight;
    }

    void main() {
      vec2 uv = vUv;
      float split = 0.0;

      if (uGlitch > 0.001) {
        float tick = floor(uTime * 20.0);
        float blockNoise = hash21(floor(uv * vec2(14.0, 9.0)) + tick);
        float sliceNoise = hash21(floor(uv * vec2(1.0, 60.0)) + tick * 1.7);
        float blockHit = step(1.0 - 0.45 * uGlitch, blockNoise);
        float sliceHit = step(1.0 - 0.25 * uGlitch, sliceNoise);
        float strength = smoothstep(0.0, 0.35, uGlitch);
        uv.x += ((blockNoise - 0.5) * 0.18 * blockHit + (sliceNoise - 0.5) * 0.1 * sliceHit) * strength;
        split = 0.012 * uGlitch + 0.02 * uGlitch * blockHit;
      }

      vec2 fromCentre = (vUv - 0.5) * vec2(uAspect, 1.0);
      // Fringing grows with distance from the centre, like a real lens, and never vanishes at it.
      vec2 radial = (vUv - 0.5) * uAberration * 0.022 * (0.3 + 2.4 * dot(fromCentre, fromCentre));
      vec2 offset = radial + vec2(split, 0.0);

      vec3 col;
      if (dot(offset, offset) > 1e-9) {
        col = sampleFringed(uv, offset);
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      col = mix(col, uFlashColor, uFlash);

      float vignette = smoothstep(1.05, 0.35, length(fromCentre));
      col *= mix(1.0, vignette, uVignette);

      float grain = hash21(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
      col *= 1.0 + grain * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
