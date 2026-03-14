export type TokenAxis = "personality" | "density" | "contrast" | "hue" | "motion";

export interface SliderState {
  personality: number;
  density: number;
  contrast: number;
  hue: number;
  motion: number;
}

export interface SliderAxisConfig {
  id: TokenAxis;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const DEFAULT_SLIDER_STATE: SliderState = {
  personality: 44,
  density: 36,
  contrast: 22,
  hue: 248,
  motion: 62,
};

export const SLIDER_AXES: SliderAxisConfig[] = [
  { id: "personality", label: "Personality", min: 0, max: 100, step: 1 },
  { id: "density", label: "Density", min: 0, max: 100, step: 1 },
  { id: "contrast", label: "Contrast", min: 0, max: 100, step: 1 },
  { id: "hue", label: "Hue", min: 0, max: 360, step: 1 },
  { id: "motion", label: "Motion", min: 0, max: 100, step: 1 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(min: number, max: number, amount: number): number {
  return min + (max - min) * amount;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${round(s)}% ${round(l)}%)`;
}

export function normalizeSliderState(input?: Partial<SliderState> | null): SliderState {
  const value = input ?? {};
  return {
    personality: clamp(Number(value.personality ?? DEFAULT_SLIDER_STATE.personality), 0, 100),
    density: clamp(Number(value.density ?? DEFAULT_SLIDER_STATE.density), 0, 100),
    contrast: clamp(Number(value.contrast ?? DEFAULT_SLIDER_STATE.contrast), 0, 100),
    hue: clamp(Number(value.hue ?? DEFAULT_SLIDER_STATE.hue), 0, 360),
    motion: clamp(Number(value.motion ?? DEFAULT_SLIDER_STATE.motion), 0, 100),
  };
}

export function resolveTokenVariables(input?: Partial<SliderState> | null): Record<string, string> {
  const state = normalizeSliderState(input);
  const personality = state.personality / 100;
  const density = state.density / 100;
  const contrast = state.contrast / 100;
  const motion = state.motion / 100;
  const bgLightness = lerp(98, 8, contrast);
  const surfaceLightness = lerp(100, 12, contrast);
  const isDarkSurface = bgLightness < 50;
  const accentSaturation = lerp(15, 70, personality);
  const accentLightness = lerp(50, 55, personality);
  const shadowAlpha = lerp(0.08, 0.28, contrast);

  return {
    "--radius-base": `${round(lerp(2, 16, personality))}px`,
    "--font-family-display":
      personality < 35
        ? '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace'
        : personality < 72
          ? '"Avenir Next", "Segoe UI", sans-serif'
          : 'Georgia, "Times New Roman", serif',
    "--color-accent": hsl(state.hue, accentSaturation, accentLightness),
    "--spacing-multiplier": String(round(lerp(0.85, 1.25, personality))),
    "--padding-card": `${round(lerp(2, 0.75, density))}rem`,
    "--font-size-base": `${round(lerp(16, 12, density))}px`,
    "--gap-base": `${round(lerp(1.5, 0.5, density))}rem`,
    "--line-height": String(round(lerp(1.8, 1.3, density))),
    "--color-bg": hsl(220, lerp(15, 20, contrast), bgLightness),
    "--color-surface": hsl(220, lerp(10, 14, contrast), surfaceLightness),
    "--color-surface-strong": hsl(220, lerp(12, 18, contrast), round(isDarkSurface ? surfaceLightness + 6 : surfaceLightness - 4)),
    "--color-fg": hsl(220, 16, isDarkSurface ? 94 : 14),
    "--color-muted": hsl(220, 11, isDarkSurface ? 72 : 38),
    "--color-border": `rgba(0, 0, 0, ${round(lerp(0.05, 0.4, contrast))})`,
    "--font-weight-body": String(Math.round(lerp(300, 500, contrast))),
    "--shadow-card": contrast < 0.08 ? "none" : `0 2px 8px rgba(0, 0, 0, ${round(shadowAlpha)})`,
    "--hue-accent": String(Math.round(state.hue)),
    "--transition-speed": `${Math.round(lerp(0, 300, motion))}ms`,
    "--animation-enabled": motion < 0.08 ? "0" : "1",
  };
}

export function applyTokensToElement(element: HTMLElement, input?: Partial<SliderState> | null): SliderState {
  const state = normalizeSliderState(input);
  const variables = resolveTokenVariables(state);
  for (const [key, value] of Object.entries(variables)) {
    element.style.setProperty(key, value);
  }
  return state;
}
