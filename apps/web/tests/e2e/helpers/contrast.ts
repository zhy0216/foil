import type { Page } from '@playwright/test';

// Computed colors keep their authored color space (oklch, color-mix results),
// so resolve them through the page's own canvas instead of parsing them here.
// An unparseable value throws rather than silently measuring the sentinel.
const SENTINEL = '#010203';

function channels(page: Page, color: string) {
  return page.evaluate(([value, sentinel]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = sentinel;
    ctx.fillStyle = value;
    if (ctx.fillStyle === sentinel) return null;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, [color, SENTINEL] as const).then((rgb) => {
    if (!rgb) throw new Error(`Browser cannot resolve the color ${JSON.stringify(color)}`);
    return rgb;
  });
}

/** WCAG relative luminance contrast between two computed CSS colors. */
export async function contrastRatio(page: Page, foreground: string, background: string) {
  const [a, b] = [await channels(page, foreground), await channels(page, background)];
  const luminance = (rgb: number[]) => {
    const channel = (value: number) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
