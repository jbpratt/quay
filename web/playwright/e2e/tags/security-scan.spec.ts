import {test, expect, getTestUsers} from '../../fixtures';
import {ApiClient} from '../../utils/api';
import {pushImage, pushOCIImage} from '../../utils/container';

test.describe(
  'Security Scan',
  {tag: ['@tags', '@container', '@feature:SECURITY_SCANNER']},
  () => {
    let user: {username: string; password: string};

    test.beforeAll(({cachedQuayConfig}) => {
      user = getTestUsers(cachedQuayConfig).user;
    });

    let testRepo: {namespace: string; name: string; fullName: string};

    test.beforeAll(async ({userContext, cachedContainerAvailable}) => {
      // Covers the image push plus the 120s Clair poll below.
      test.setTimeout(240000);
      if (!cachedContainerAvailable) return;

      const api = new ApiClient(userContext.request);
      const repoName = `secscan-${Date.now()}`;
      await api.createRepository(user.username, repoName, 'public');

      testRepo = {
        namespace: user.username,
        name: repoName,
        fullName: `${user.username}/${repoName}`,
      };

      await pushImage(
        testRepo.namespace,
        testRepo.name,
        'latest',
        user.username,
        user.password,
      );

      // Wait for Clair to scan the image (poll until status != queued)
      const tags = await api.getTags(testRepo.namespace, testRepo.name);
      const digest = tags.tags[0].manifest_digest;
      await expect
        .poll(
          async () =>
            (
              await api.getManifestSecurity(
                testRepo.namespace,
                testRepo.name,
                digest,
              )
            ).status,
          {timeout: 120000, intervals: [5000]},
        )
        .not.toBe('queued');
    });

    test.afterAll(async ({userContext}) => {
      if (!testRepo) return;
      const api = new ApiClient(userContext.request);
      try {
        await api.deleteRepository(testRepo.namespace, testRepo.name);
      } catch {
        // Ignore cleanup errors
      }
    });

    test('shows security scan results for a pushed image', async ({
      authenticatedPage,
    }) => {
      // Verify Security column visible on tags page
      await authenticatedPage.goto(`/repository/${testRepo.fullName}?tab=tags`);
      await expect(
        authenticatedPage.getByRole('link', {name: 'latest'}),
      ).toBeVisible();
      await expect(
        authenticatedPage.locator('th').filter({hasText: 'Security'}),
      ).toBeVisible();

      // Navigate to tag detail - verify Security Report and Packages tabs exist
      await authenticatedPage.getByRole('link', {name: 'latest'}).click();
      await expect(
        authenticatedPage.getByRole('tab', {name: 'Security Report'}),
      ).toBeVisible();
      await expect(
        authenticatedPage.getByRole('tab', {name: 'Packages'}),
      ).toBeVisible();

      // Click Security Report tab - verify scan completed (not queued/failed)
      await authenticatedPage
        .getByRole('tab', {name: 'Security Report'})
        .click();
      await expect(authenticatedPage).toHaveURL(/tab=securityreport/);
      await expect(
        authenticatedPage.getByText(
          /detected \d+ vulnerabilit|detected no vulnerabilit/,
        ),
      ).toBeVisible({timeout: 10000});

      // Verify vulnerability chart rendered
      await expect(
        authenticatedPage.locator('[data-testid="vulnerability-chart"]'),
      ).toBeVisible();

      // Click Packages tab - verify packages content rendered
      await authenticatedPage.getByRole('tab', {name: 'Packages'}).click();
      await expect(authenticatedPage).toHaveURL(/tab=packages/);
      await expect(
        authenticatedPage.locator('[data-testid="packages-chart"]'),
      ).toBeVisible();
      // Should show either packages recognized or no packages recognized
      await expect(
        authenticatedPage.getByText(
          /recognized \d+ package|does not recognize any package/,
        ),
      ).toBeVisible();
    });

    test('vulnerability report supports filtering and sorting', async ({
      authenticatedPage,
    }) => {
      await authenticatedPage.goto(
        `/repository/${testRepo.fullName}/tag/latest?tab=securityreport`,
      );
      await expect(
        authenticatedPage.getByText(
          /detected \d+ vulnerabilit|detected no vulnerabilit/,
        ),
      ).toBeVisible({timeout: 10000});

      const vulnRows = authenticatedPage.locator('td[data-label="Advisory"]');
      const initialCount = await vulnRows.count();
      if (initialCount === 0) {
        // No vulnerabilities to filter - skip interaction tests
        return;
      }

      // Test fixable-only checkbox
      await authenticatedPage.locator('#fixable-checkbox').check();
      const fixableCount = await vulnRows.count();
      expect(fixableCount).toBeLessThanOrEqual(initialCount);
      await authenticatedPage.locator('#fixable-checkbox').uncheck();
      await expect(vulnRows).toHaveCount(initialCount);

      // Test name filter
      const firstPackage = await authenticatedPage
        .locator('td[data-label="Package"] >> nth=0')
        .innerText();
      const filterTerm = firstPackage.slice(0, 3);
      await authenticatedPage
        .locator('input[placeholder="Filter Vulnerabilities..."]')
        .fill(filterTerm);
      const filteredCount = await vulnRows.count();
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
      await authenticatedPage
        .locator('input[placeholder="Filter Vulnerabilities..."]')
        .clear();
      await expect(vulnRows).toHaveCount(initialCount);

      // Test sorting - click severity sort and verify table still renders
      await authenticatedPage.locator('#severity-sort button').click();
      await expect(vulnRows.first()).toBeVisible();
    });

    test('packages tab supports filtering', async ({authenticatedPage}) => {
      await authenticatedPage.goto(
        `/repository/${testRepo.fullName}/tag/latest?tab=packages`,
      );
      await expect(
        authenticatedPage.getByText(
          /recognized \d+ package|does not recognize any package/,
        ),
      ).toBeVisible({timeout: 10000});

      const packageRows = authenticatedPage.locator(
        'td[data-label="Package Name"]',
      );
      const initialCount = await packageRows.count();
      if (initialCount === 0) {
        return;
      }

      // Test name filter
      const firstPackage = await packageRows.first().innerText();
      const filterTerm = firstPackage.slice(0, 3);
      await authenticatedPage
        .locator('input[placeholder="Filter Packages..."]')
        .fill(filterTerm);
      const filteredCount = await packageRows.count();
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
      await authenticatedPage
        .locator('input[placeholder="Filter Packages..."]')
        .clear();
      await expect(packageRows).toHaveCount(initialCount);
    });
  },
);

test.describe(
  'Pending security status on push',
  {tag: ['@tags', '@container', '@feature:SECURITY_SCANNER']},
  () => {
    let user: {username: string; password: string};

    test.beforeAll(({cachedQuayConfig}) => {
      user = getTestUsers(cachedQuayConfig).user;
    });

    test('security scan is queued immediately after push', async ({
      userContext,
      cachedContainerAvailable,
      authenticatedPage,
    }) => {
      test.skip(!cachedContainerAvailable, 'Container runtime unavailable');
      test.setTimeout(60000);

      const api = new ApiClient(userContext.request);
      const repoName = `secscan-pending-${Date.now()}`;
      await api.createRepository(user.username, repoName, 'public');

      try {
        await pushImage(
          user.username,
          repoName,
          'latest',
          user.username,
          user.password,
        );

        const tags = await api.getTags(user.username, repoName);
        const digest = tags.tags[0].manifest_digest;
        const sec = await api.getManifestSecurity(
          user.username,
          repoName,
          digest,
        );
        expect(sec.status).toBe('queued');

        await authenticatedPage.goto(
          `/repository/${user.username}/${repoName}?tab=tags`,
        );
        await expect(
          authenticatedPage.locator('th').filter({hasText: 'Security'}),
        ).toBeVisible();
        await expect(authenticatedPage.getByText('Queued')).toBeVisible();
      } finally {
        try {
          await api.deleteRepository(user.username, repoName);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  },
);

test.describe(
  'OCI Image Security Scan (PROJQUAY-11333)',
  {tag: ['@tags', '@container', '@feature:SECURITY_SCANNER']},
  () => {
    let user: {username: string; password: string};

    test.beforeAll(({cachedQuayConfig}) => {
      user = getTestUsers(cachedQuayConfig).user;
    });

    let testRepo: {namespace: string; name: string; fullName: string};

    test.beforeAll(async ({userContext, cachedContainerAvailable}) => {
      test.setTimeout(180000);
      if (!cachedContainerAvailable) return;

      const api = new ApiClient(userContext.request);
      const repoName = `oci-secscan-${Date.now()}`;
      await api.createRepository(user.username, repoName, 'public');

      testRepo = {
        namespace: user.username,
        name: repoName,
        fullName: `${user.username}/${repoName}`,
      };

      await pushOCIImage(
        testRepo.namespace,
        testRepo.name,
        'latest',
        user.username,
        user.password,
      );

      // Wait for Clair to scan the OCI image
      const tags = await api.getTags(testRepo.namespace, testRepo.name);
      const digest = tags.tags[0].manifest_digest;
      // Fall through on timeout: without SECURITY_SCANNER the manifest stays
      // 404 and the tests skip on their feature tag instead of failing here.
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        try {
          const sec = await api.getManifestSecurity(
            testRepo.namespace,
            testRepo.name,
            digest,
          );
          if (sec.status !== 'queued') break;
        } catch (e: unknown) {
          if (e instanceof Error && !e.message.includes('404')) throw e;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    });

    test.afterAll(async ({userContext}) => {
      if (!testRepo) return;
      const api = new ApiClient(userContext.request);
      try {
        await api.deleteRepository(testRepo.namespace, testRepo.name);
      } catch {
        // Ignore cleanup errors
      }
    });

    test('OCI-format image is scanned successfully, not marked as unsupported', async ({
      authenticatedPage,
    }) => {
      test.setTimeout(120000);
      await authenticatedPage.goto(
        `/repository/${testRepo.fullName}/tag/latest?tab=securityreport`,
      );

      // Verify Security Report tab exists and is selected
      await expect(
        authenticatedPage.getByRole('tab', {name: 'Security Report'}),
      ).toBeVisible();

      // The fix ensures OCI images are NOT marked as unsupported
      await expect(
        authenticatedPage.getByText('Security scan is not supported.'),
      ).not.toBeVisible();

      // Wait for scan to complete — reload if still queued
      const scanned = authenticatedPage.getByText(
        /detected \d+ vulnerabilit|detected no vulnerabilit/,
      );
      await expect
        .poll(
          async () => {
            if (await scanned.isVisible().catch(() => false)) return true;
            await authenticatedPage.reload();
            await authenticatedPage
              .getByRole('tab', {name: 'Security Report'})
              .click();
            return false;
          },
          {timeout: 90000, intervals: [5000]},
        )
        .toBe(true);

      await expect(
        authenticatedPage.locator('[data-testid="vulnerability-chart"]'),
      ).toBeVisible();
    });

    test('OCI-format image packages tab renders', async ({
      authenticatedPage,
    }) => {
      test.setTimeout(120000);
      await authenticatedPage.goto(
        `/repository/${testRepo.fullName}/tag/latest?tab=packages`,
      );

      const packages = authenticatedPage.getByText(
        /recognized \d+ package|does not recognize any package/,
      );
      await expect
        .poll(
          async () => {
            if (await packages.isVisible().catch(() => false)) return true;
            await authenticatedPage.reload();
            return false;
          },
          {timeout: 90000, intervals: [5000]},
        )
        .toBe(true);

      await expect(
        authenticatedPage.locator('[data-testid="packages-chart"]'),
      ).toBeVisible();
    });
  },
);
