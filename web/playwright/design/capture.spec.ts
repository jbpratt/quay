import path from 'path';
import {test, expect} from '../fixtures';
import {DESIGN_ROUTES, createDesignData, waitForDesignReady} from './routes';

const SHOTS_DIR = path.resolve(
  process.env.DESIGN_SHOTS_DIR || 'test-results/design/shots',
);

test.describe('Design capture', () => {
  // userContext is worker-scoped, so a leftover preference would theme the
  // next test.
  test.afterEach(async ({authenticatedPage}) => {
    // localStorage throws on about:blank, e.g. when setup failed before goto.
    if (authenticatedPage.url() === 'about:blank') return;
    await authenticatedPage.evaluate(() =>
      localStorage.removeItem('theme-preference'),
    );
  });

  for (const route of DESIGN_ROUTES) {
    test(route.slug, async ({authenticatedPage, api}) => {
      await authenticatedPage.goto(route.path(await createDesignData(api)));

      for (const theme of ['light', 'dark']) {
        await authenticatedPage.setViewportSize({width: 1280, height: 800});
        await authenticatedPage.evaluate(
          (pref) => localStorage.setItem('theme-preference', pref),
          theme.toUpperCase(),
        );
        await authenticatedPage.reload();
        await waitForDesignReady(authenticatedPage);

        const html = expect(authenticatedPage.locator('html'));
        if (theme === 'dark') {
          await html.toHaveClass(/pf-v6-theme-dark/);
        } else {
          await html.not.toHaveClass(/pf-v6-theme-dark/);
        }

        // PF6 pins the page to 100vh and scrolls inside page__main, so
        // fullPage alone stops at the viewport; grow it to fit the content.
        const overflow = await authenticatedPage
          .locator('.pf-v6-c-page__main')
          .evaluate((el) => el.scrollHeight - el.clientHeight);
        await authenticatedPage.setViewportSize({
          width: 1280,
          height: 800 + overflow,
        });

        await authenticatedPage.screenshot({
          path: path.join(SHOTS_DIR, `${route.slug}-${theme}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    });
  }
});
