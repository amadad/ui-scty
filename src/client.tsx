import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { WidgetSurface, DEFAULT_WIDGET_SPEC } from "./renderer";
import { applyTokensToElement, DEFAULT_SLIDER_STATE, normalizeSliderState, type SliderState } from "./tokens";

type BootPayload = {
  slug: string;
  title: string;
  spec: string | null;
  tokens: Partial<SliderState> | null;
};

declare global {
  interface Window {
    __WIDGET_BOOT__?: BootPayload;
  }
}

const boot = window.__WIDGET_BOOT__;

if (!boot) {
  throw new Error("Widget boot payload missing");
}

const widgetRoot = document.getElementById("widget-root");
if (!widgetRoot) {
  throw new Error("Widget root missing");
}

let currentSpec = boot.spec && boot.spec.trim() ? boot.spec : DEFAULT_WIDGET_SPEC;
const reactRoot = hydrateRoot(widgetRoot, <WidgetSurface specString={currentSpec} />);

const sliderState = initializeSliders(boot.slug, boot.tokens);
applyTokensToElement(document.documentElement, sliderState);
updateSliderLabels(sliderState);
setupPanelToggle();
setupRefineBar(boot.slug);
setupEventStream(boot.slug);

function initializeSliders(slug: string, serverTokens: Partial<SliderState> | null): SliderState {
  const localValue = readLocalTokens(slug);
  const resolved = normalizeSliderState(localValue ?? serverTokens ?? DEFAULT_SLIDER_STATE);

  for (const [axis, value] of Object.entries(resolved) as Array<[keyof SliderState, number]>) {
    const input = document.querySelector<HTMLInputElement>(`[data-slider="${axis}"]`);
    if (!input) {
      continue;
    }

    input.value = String(value);
    input.addEventListener("input", () => {
      resolved[axis] = Number(input.value);
      const next = normalizeSliderState(resolved);
      Object.assign(resolved, next);
      applyTokensToElement(document.documentElement, resolved);
      updateSliderLabels(resolved);
      persistLocalTokens(slug, resolved);
    });

    input.addEventListener("change", () => {
      void persistServerTokens(slug, resolved);
    });
  }

  persistLocalTokens(slug, resolved);
  return resolved;
}

function setupPanelToggle(): void {
  const toggle = document.getElementById("style-toggle");
  if (!toggle) {
    return;
  }

  toggle.addEventListener("click", () => {
    const next = document.body.dataset.panelOpen === "false" ? "true" : "false";
    document.body.dataset.panelOpen = next;
  });
}

function setupEventStream(slug: string): void {
  const pill = document.getElementById("connection-pill");
  const source = new EventSource(`/widget/${slug}/events`);
  const handleMessage = (event: MessageEvent<string>) => {
    const data = JSON.parse(event.data) as { type?: string; spec?: string };
    if (data.type !== "spec" || !data.spec) {
      return;
    }
    currentSpec = data.spec;
    startTransition(() => {
      reactRoot.render(<WidgetSurface specString={currentSpec} />);
    });
    setStatus("Updated", 3000);
  };

  source.onopen = () => {
    if (pill) {
      pill.textContent = "Live";
      pill.dataset.state = "live";
    }
  };

  source.onmessage = handleMessage;
  source.addEventListener("spec", handleMessage);
  source.onerror = () => {
    if (pill) {
      pill.textContent = "Reconnecting";
      pill.dataset.state = "offline";
    }
  };
}

function setupRefineBar(slug: string): void {
  const button = document.getElementById("refine-btn") as HTMLButtonElement | null;
  const input = document.getElementById("refine-input") as HTMLInputElement | null;

  if (!button || !input) {
    return;
  }

  const submit = async () => {
    const message = input.value.trim();
    if (!message) {
      return;
    }

    button.disabled = true;
    setStatus("Sending...");

    try {
      const response = await fetch(`/widget/${slug}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, message, currentSpec }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setStatus("Queued");
      input.value = "";
    } catch {
      setStatus("Refine failed", 4000);
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener("click", () => {
    void submit();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  });
}

function updateSliderLabels(state: SliderState): void {
  for (const [axis, value] of Object.entries(state)) {
    const target = document.querySelector<HTMLOutputElement>(`[data-slider-value="${axis}"]`);
    if (target) {
      target.value = String(value);
      target.textContent = String(value);
    }
  }
}

function setStatus(text: string, clearAfterMs?: number): void {
  const status = document.getElementById("refine-status");
  if (!status) {
    return;
  }

  status.textContent = text;
  if (clearAfterMs) {
    window.setTimeout(() => {
      if (status.textContent === text) {
        status.textContent = "";
      }
    }, clearAfterMs);
  }
}

function readLocalTokens(slug: string): Partial<SliderState> | null {
  try {
    const raw = window.localStorage.getItem(slug);
    return raw ? JSON.parse(raw) as Partial<SliderState> : null;
  } catch {
    return null;
  }
}

function persistLocalTokens(slug: string, state: SliderState): void {
  try {
    window.localStorage.setItem(slug, JSON.stringify(state));
  } catch {
    // Ignore quota and storage errors.
  }
}

async function persistServerTokens(slug: string, state: SliderState): Promise<void> {
  try {
    await fetch(`/widget/${slug}/tokens`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: state }),
    });
  } catch {
    // Best-effort persistence only.
  }
}
