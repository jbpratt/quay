/**
 * SCRATCH — temporary CI probe for goal qu-p7x0e. DO NOT MERGE.
 *
 * The OTel trace-attachment feature (JAEGER_QUERY_URL / failure-artifacts.ts)
 * has never fired on a real CI failure. These tests deliberately fail after
 * making real API calls so the attachment path has something to collect and
 * a human can judge whether the resulting artifact is useful. This file must
 * be deleted before PR 7196 merges.
 */

import {test, expect, uniqueName} from '../fixtures';
import {TEST_USERS} from '../global-setup';

test.describe(
  'SCRATCH: OTel trace evidence (qu-p7x0e)',
  {tag: ['@auth:Database']},
  () => {
    test(
      'api-only: list orgs, create repo, read it back, then fail',
      {tag: '@api'},
      async ({userClient}) => {
        const namespace = TEST_USERS.user.username;
        const repoName = uniqueName('scratch_trace_repo');

        try {
          // list orgs
          const userResp = await userClient.get('/api/v1/user/');
          expect(userResp.status()).toBe(200);
          const userBody = await userResp.json();
          expect(Array.isArray(userBody.organizations)).toBe(true);

          // create a repo
          const createResp = await userClient.post('/api/v1/repository', {
            namespace,
            repository: repoName,
            visibility: 'private',
            description: '',
            repo_kind: 'image',
          });
          expect(createResp.status()).toBe(201);

          // read it back
          const readResp = await userClient.get(
            `/api/v1/repository/${namespace}/${repoName}`,
          );
          expect(readResp.status()).toBe(200);
          const repoBody = await readResp.json();

          expect(
            repoBody.name,
            'SCRATCH deliberate failure for qu-p7x0e: probing trace attachment on the API-only path',
          ).toBe('this-name-will-never-match');
        } finally {
          await userClient.delete(
            `/api/v1/repository/${namespace}/${repoName}`,
          );
        }
      },
    );

    test('browser: navigate and trigger real backend calls, then fail', async ({
      authenticatedPage,
      api,
    }) => {
      const repo = await api.repository(undefined, 'scratch_trace_repo');

      await authenticatedPage.goto(
        `/repository/${repo.namespace}/${repo.name}`,
      );
      await expect(authenticatedPage.getByText(repo.name)).toBeVisible();

      expect(
        false,
        'SCRATCH deliberate failure for qu-p7x0e: probing trace attachment on the browser path',
      ).toBe(true);
    });

    test(
      'api-only: request that errors (404), then fail',
      {tag: '@api'},
      async ({userClient}) => {
        const missingResp = await userClient.get(
          '/api/v1/repository/testuser/scratch-trace-evidence-missing-404',
        );
        expect(missingResp.status()).toBe(404);

        expect(
          false,
          'SCRATCH deliberate failure for qu-p7x0e: probing trace attachment on an error-status path',
        ).toBe(true);
      },
    );
  },
);
