import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

// Fixed sample covering prose settings, ordered/unordered/task lists, nesting,
// code and a quote with every explicit inline emphasis.
const SAMPLE_MD = [
  '# Typography sample',
  '',
  'Body paragraph with **bold** and *italic* and ==mark== and ~~strike~~.',
  '',
  '1. First ordered item',
  '2. Second ordered item',
  '42) Answer with a different delimiter',
  '',
  '- unordered item with marker',
  '- [x] completed task',
  '  - nested unordered item',
  '',
  '> Quoted **bold** and *italic* and ==mark== and ~~strike~~ text.',
  '',
  '```ts',
  'const value = 42;',
  '```',
].join('\n');

const DOC_ID = 'e2e-typography';
const PROSE_PX = { small: 17, default: 19, large: 21 } as const;
type ProseSize = keyof typeof PROSE_PX;
type Density = 'compact' | 'comfortable';

interface SeedSettings {
  theme?: 'light' | 'dark';
  proseSize?: ProseSize;
  density?: Density;
}

function settingsFor(overrides: SeedSettings = {}) {
  return {
    theme: 'light',
    proseFont: 'serif',
    proseSize: 'large',
    accent: 'cerulean',
    editorWidth: 'default',
    density: 'compact',
    ...overrides,
  };
}

// Personal settings and the document live in browser storage, so seeding them
// exercises the real bootstrap path without driving the settings UI first.
async function seedDoc(page: Page, settings: SeedSettings = {}) {
  await page.goto('./');
  await page.evaluate(({ md, id, next }) => {
    const now = Date.now();
    localStorage.setItem('foil_settings', JSON.stringify(next));
    localStorage.setItem(`foil_doc_${id}`, JSON.stringify({
      id, title: 'Typography sample', md, comments: [], createdAt: now, updatedAt: now,
    }));
    sessionStorage.setItem('foil_current_id', id);
  }, { md: SAMPLE_MD, id: DOC_ID, next: settingsFor(settings) });
  await page.reload();
}

async function setSettings(page: Page, overrides: SeedSettings) {
  await page.evaluate((next) => {
    const current = JSON.parse(localStorage.getItem('foil_settings') || '{}');
    localStorage.setItem('foil_settings', JSON.stringify({ ...current, ...next }));
  }, overrides);
}

async function updateSettings(page: Page, overrides: SeedSettings) {
  await setSettings(page, overrides);
  await page.reload();
}

// Every HTTP(S) request is intercepted; only the local build may answer.
async function blockExternal(context: BrowserContext, baseURL: string, seen: string[]) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) {
      await route.continue();
    } else {
      seen.push(route.request().url());
      await route.abort();
    }
  });
}

async function lineMetrics(root: Locator) {
  return root.evaluate((el) => {
    const pick = (selector: string) => {
      const line = el.querySelector<HTMLElement>(selector);
      if (!line) throw new Error(`missing ${selector}`);
      const style = getComputedStyle(line);
      return {
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        height: line.getBoundingClientRect().height,
        opacity: parseFloat(getComputedStyle(line.querySelector('.syn') ?? line).opacity),
      };
    };
    return {
      paragraph: pick('.ln.p'),
      unordered: pick('.ln.ulist'),
      ordered: pick('.ln.olist'),
      heading: pick('.ln.h1'),
      code: pick('.ln.code'),
    };
  });
}

test('prose size and density drive editor line boxes while UI chrome stays fixed', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  await seedDoc(page);
  const editor = page.locator('.editor[contenteditable="true"]');
  await expect(editor).toBeVisible();

  for (const [proseSize, px] of Object.entries(PROSE_PX) as [ProseSize, number][]) {
    for (const density of ['compact', 'comfortable'] as Density[]) {
      await updateSettings(page, { proseSize, density });
      await expect(editor).toBeVisible();
      const m = await lineMetrics(editor);
      const leading = density === 'compact' ? 1.55 : 1.7;

      expect(m.paragraph.fontSize).toBe(px);
      expect(m.paragraph.lineHeight).toBeCloseTo(px * leading, 1);
      expect(m.unordered.fontSize).toBe(px);
      expect(m.unordered.lineHeight).toBeCloseTo(px * leading, 1);
      // List rows are not stretched past their own line box.
      expect(m.unordered.height).toBeLessThanOrEqual(m.unordered.lineHeight + 1);
      // Headings keep their own 36px * 1.15 line box, never a 1.7em prose floor.
      expect(m.heading.height).toBeCloseTo(36 * 1.15, 0);
      expect(m.heading.height).toBeLessThan(36 * 1.7 - 1);
      // Code rows keep their natural height too.
      expect(m.code.height).toBeLessThanOrEqual(m.code.lineHeight + 1);
    }
  }

  // Empty lines remain a clickable line box that accepts a caret.
  await updateSettings(page, { proseSize: 'large', density: 'compact' });
  await editor.locator('.ln.empty').first().click();
  await page.keyboard.type('x');
  await expect(editor.locator('.ln[data-i="1"]')).toHaveText('x');

  // UI chrome has a fixed type scale independent of the prose settings.
  await page.getByRole('button', { name: 'Settings' }).click();
  const modalSub = page.locator('.settings-modal .modal-sub');
  await expect(modalSub).toBeVisible();
  expect(await modalSub.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
  expect(await page.locator('.statusbar').evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px');

  await page.locator('.settings-section', { hasText: 'Text size' }).getByRole('radio', { name: 'Small' }).click();
  await expect.poll(async () => (await lineMetrics(editor)).paragraph.fontSize).toBe(17);
  expect(await modalSub.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
  expect(await page.locator('.statusbar').evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px');

  expect(external).toEqual([]);
});

test('preview reuses prose settings, ordered markers and readable quotes', async ({ page, context, baseURL }) => {
  const external: string[] = [];
  await blockExternal(context, baseURL!, external);
  await seedDoc(page, { density: 'compact', theme: 'light' });
  await expect(page.locator('.editor[contenteditable="true"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.getByRole('button', { name: /Share/ }).click();
  const link = page.locator('.url-row input');
  await expect(link).toHaveValue(/#d=[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const shareURL = await link.inputValue();

  const recipient = await context.newPage();
  await recipient.goto(shareURL);
  // This spec pins the line-faithful Source view; Reading is the default.
  await recipient.getByRole('button', { name: 'Source', exact: true }).click();
  const preview = recipient.locator('.editor.readonly.preview');
  await expect(preview).toBeVisible();

  // Ordered lists show the raw marker; unordered/task rows keep their bullet.
  await expect(preview.locator('.ln.olist').nth(0)).toContainText('1. First ordered item');
  await expect(preview.locator('.ln.olist').nth(2)).toContainText('42) Answer with a different delimiter');
  expect(await preview.locator('.ln.olist .syn-bullet').count()).toBe(0);
  await expect(preview.locator('.ln.ulist .syn-bullet')).toHaveCount(2);
  await expect(preview.locator('.ln.task .syn-bullet')).toHaveCount(1);
  expect(await preview.locator('.ln.ulist').nth(1).evaluate((el) => el.textContent)).toBe('  - nested unordered item');

  // The preview recovers every size/density combination. The app strips the
  // share hash, so re-entering the same URL is a same-document navigation;
  // leave the origin first to force a fresh load that reads the new settings.
  let largeCompactHeight = 0;
  for (const [proseSize, px] of Object.entries(PROSE_PX) as [ProseSize, number][]) {
    for (const density of ['compact', 'comfortable'] as Density[]) {
      await setSettings(recipient, { proseSize, density });
      await recipient.goto('about:blank');
      await recipient.goto(shareURL);
      await expect(preview).toBeVisible();
      const m = await lineMetrics(preview);
      const leading = density === 'compact' ? 1.55 : 1.7;
      expect(m.paragraph.fontSize).toBe(px);
      expect(m.paragraph.lineHeight).toBeCloseTo(px * leading, 1);
      expect(m.unordered.fontSize).toBe(px);
      expect(m.unordered.lineHeight).toBeCloseTo(px * leading, 1);
      expect(m.unordered.height).toBeLessThanOrEqual(m.unordered.lineHeight + 1);
      if (proseSize === 'large' && density === 'compact') {
        expect(m.ordered.opacity).toBeGreaterThan(0.4);
        largeCompactHeight = m.unordered.height;
      } else if (proseSize === 'large') {
        expect(m.unordered.height).toBeGreaterThan(largeCompactHeight + 2);
      }
    }
  }
  expect(largeCompactHeight).toBeGreaterThan(0);
  expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // Quote text stays normal-weight prose at a readable contrast in both themes;
  // user emphasis still stands out.
  for (const theme of ['light', 'dark'] as const) {
    await setSettings(recipient, { theme });
    await recipient.goto('about:blank');
    await recipient.goto(shareURL);
    await expect(preview.locator('.ln.quote')).toBeVisible();
    const quote = await preview.locator('.ln.quote').evaluate((line) => {
      const pixel = (color: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb: number[]) =>
        0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
      const quoteColor = getComputedStyle(line).color;
      const background = getComputedStyle(document.documentElement).backgroundColor;
      const foregroundLum = luminance(pixel(quoteColor));
      const backgroundLum = luminance(pixel(background));
      const bold = line.querySelector<HTMLElement>('.md-bold')!;
      return {
        ratio: (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05),
        fontStyle: getComputedStyle(line).fontStyle,
        boldDiffers: JSON.stringify(pixel(getComputedStyle(bold).color)) !== JSON.stringify(pixel(quoteColor)),
        boldWeight: getComputedStyle(bold).fontWeight,
        italicStyle: getComputedStyle(line.querySelector<HTMLElement>('.md-em')!).fontStyle,
        markBackground: getComputedStyle(line.querySelector<HTMLElement>('.md-mark')!).backgroundColor,
        strikeLine: getComputedStyle(line.querySelector<HTMLElement>('.md-strike')!).textDecorationLine,
      };
    });
    expect(quote.fontStyle).toBe('normal');
    expect(quote.ratio).toBeGreaterThanOrEqual(4.5);
    expect(quote.boldDiffers).toBe(true);
    expect(Number(quote.boldWeight)).toBeGreaterThanOrEqual(700);
    expect(quote.italicStyle).toBe('italic');
    expect(quote.markBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(quote.strikeLine).toContain('line-through');
  }

  expect(external).toEqual([]);
});
