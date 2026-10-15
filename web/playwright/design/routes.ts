import type {Page} from '@playwright/test';
import {expect, type TestApi} from '../fixtures';

interface DesignData {
  org: string;
  repo: string;
}

// Shared by capture and a11y smoke so both cover the same pages.
export const DESIGN_ROUTES: {slug: string; path: (d: DesignData) => string}[] =
  [
    {slug: 'repositories', path: () => '/repository'},
    {slug: 'organizations', path: () => '/organization'},
    {slug: 'organization', path: (d) => `/organization/${d.org}`},
    {slug: 'repository', path: (d) => `/repository/${d.org}/${d.repo}`},
  ];

export async function createDesignData(api: TestApi): Promise<DesignData> {
  const org = await api.organization('design');
  const repo = await api.repository(org.name, 'design');
  return {org: org.name, repo: repo.name};
}

// networkidle fires before the dev server's first render and while PF
// spinners are still up, which captures blank or "Loading" pages.
export async function waitForDesignReady(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.pf-v6-c-page__main')).toBeVisible();
  await expect(page.locator('.pf-v6-c-spinner:visible')).toHaveCount(0);
  await expect(page.locator('.pf-v6-c-skeleton:visible')).toHaveCount(0);
}
