import { WHATSAPP_LOGGED_IN_SELECTORS, WHATSAPP_QR_HINTS } from "../../shared/config";

function pageText(): string {
  return String(document.body?.innerText || "").toLowerCase();
}

function hasQrCanvas(): boolean {
  return Array.from(document.querySelectorAll("canvas, [data-testid], [aria-label]")).some((element) => {
    const testId = String(element.getAttribute("data-testid") || "").toLowerCase();
    const aria = String(element.getAttribute("aria-label") || "").toLowerCase();
    return testId.includes("qr") || aria.includes("qr") || aria.includes("scan");
  });
}

function isQrLoginScreen(): boolean {
  const text = pageText();
  return hasQrCanvas() || WHATSAPP_QR_HINTS.some((hint) => text.includes(hint));
}

export function isWhatsAppLoggedIn(): boolean {
  if (isQrLoginScreen()) {
    return false;
  }
  return WHATSAPP_LOGGED_IN_SELECTORS.some((selector) => {
    try {
      return Boolean(document.querySelector(selector));
    } catch {
      return false;
    }
  });
}

function isColorDark(value: unknown): boolean | null {
  const raw = String(value || "").trim();
  let r;
  let g;
  let b;
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => parseFloat(part));
    [r, g, b] = parts;
  } else {
    const hex = raw.replace(/^#/, "");
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return null;
    }
  }
  if (![r, g, b].every(Number.isFinite)) {
    return null;
  }
  const luminance = ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / 255;
  return luminance < 0.5;
}

function isWhatsAppDarkTheme(): boolean {
  const classes = `${document.body?.className || ""} ${document.documentElement?.className || ""}`.toLowerCase();
  if (/(^|[\s-])dark($|[\s-])/.test(classes)) {
    return true;
  }
  if (/(^|[\s-])light($|[\s-])/.test(classes)) {
    return false;
  }

  const source = document.documentElement || document.body;
  if (source) {
    const style = getComputedStyle(source);
    const surface =
      style.getPropertyValue("--WDS-surface-default") ||
      style.getPropertyValue("--app-background") ||
      (document.body ? getComputedStyle(document.body).backgroundColor : "");
    const dark = isColorDark(surface);
    if (dark != null) {
      return dark;
    }
  }
  return false;
}

export function applyWhatsAppTheme(host: HTMLElement | null): void {
  if (host) {
    host.dataset.theme = isWhatsAppDarkTheme() ? "dark" : "light";
  }
}

export function startWhatsAppThemeWatch(
  host: HTMLElement | null,
  existingObserver: MutationObserver | null,
  onThemeChange: () => void
): MutationObserver | null {
  applyWhatsAppTheme(host);
  if (existingObserver || typeof MutationObserver !== "function") {
    return existingObserver;
  }

  const observer = new MutationObserver(onThemeChange);
  for (const target of [document.documentElement, document.body]) {
    if (target) {
      observer.observe(target, { attributes: true, attributeFilter: ["class"] });
    }
  }
  return observer;
}
