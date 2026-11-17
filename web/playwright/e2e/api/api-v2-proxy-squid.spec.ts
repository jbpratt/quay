/**
 * Proxy-cache blob streaming through an HTTP proxy (PROJQUAY-14064).
 *
 * Needs the docker-compose.proxy-squid.yaml topology: Quay sends outbound
 * HTTP through Squid, and the upstream registry is reachable only from
 * Squid's network. ci-web.yaml greps Squid's access log after this runs.
 */

import {createHash, randomBytes} from 'crypto';
import {APIRequestContext} from '@playwright/test';
import {test, expect, getTestUsers} from '../../fixtures';
import {getV2Token} from '../../utils/api/auth';
import {API_URL} from '../../utils/config';

const SQUID_E2E = process.env.PLAYWRIGHT_SQUID_E2E === '1';
// Host port that docker-compose.proxy-squid.yaml publishes for seeding.
const UPSTREAM_SEED_URL = 'http://localhost:5001';
const DENIED_BLOB_BOUND_MS = 15_000;
// Over four of blobstream's 256 KiB read chunks, so the body spans several.
const LAYER_SIZE = 1_048_577;

const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';

function digestOf(data: Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

async function pushBlob(
  request: APIRequestContext,
  repo: string,
  data: Buffer,
): Promise<string> {
  const digest = digestOf(data);
  const start = await request.post(
    `${UPSTREAM_SEED_URL}/v2/${repo}/blobs/uploads/`,
  );
  expect(start.status()).toBe(202);
  const location = new URL(start.headers()['location'], UPSTREAM_SEED_URL);
  location.searchParams.set('digest', digest);
  const put = await request.put(location.toString(), {
    headers: {'content-type': 'application/octet-stream'},
    data,
  });
  expect(put.status()).toBe(201);
  return digest;
}

// Pushes a one-layer image with a run-unique layer, so Quay's storage
// never already holds it.
async function seedUpstreamImage(
  request: APIRequestContext,
  repo: string,
): Promise<{layer: Buffer; layerDigest: string}> {
  const layer = randomBytes(LAYER_SIZE);
  const layerDigest = await pushBlob(request, repo, layer);
  const config = Buffer.from(
    JSON.stringify({
      architecture: 'amd64',
      os: 'linux',
      config: {},
      rootfs: {type: 'layers', diff_ids: [layerDigest]},
    }),
  );
  const configDigest = await pushBlob(request, repo, config);
  const manifest = {
    schemaVersion: 2,
    mediaType: OCI_MANIFEST,
    config: {
      mediaType: 'application/vnd.oci.image.config.v1+json',
      digest: configDigest,
      size: config.length,
    },
    layers: [
      {
        mediaType: 'application/vnd.oci.image.layer.v1.tar',
        digest: layerDigest,
        size: layer.length,
      },
    ],
  };
  const put = await request.put(
    `${UPSTREAM_SEED_URL}/v2/${repo}/manifests/latest`,
    {
      headers: {'content-type': OCI_MANIFEST},
      data: JSON.stringify(manifest),
    },
  );
  expect(put.status()).toBe(201);
  return {layer, layerDigest};
}

test.describe(
  'Proxy cache through Squid',
  {
    tag: ['@api', '@feature:PROXY_CACHE', '@PROJQUAY-14064', '@proxy:squid'],
  },
  () => {
    test.skip(
      !SQUID_E2E,
      'requires the docker-compose.proxy-squid.yaml topology (PLAYWRIGHT_SQUID_E2E=1)',
    );

    test('uncached proxy-cache blob uses squid and denied blob fails promptly', async ({
      api,
      request,
      cachedQuayConfig,
    }) => {
      const {username, password} = getTestUsers(cachedQuayConfig).user;
      const runId = randomBytes(6).toString('hex');

      // Seeds a distinct image, so neither case finds the other's blob in
      // Quay's storage, and returns its uncached /_upstream_proxy/ target.
      async function upstreamProxyLocation(
        upstream: string,
        repo: string,
      ): Promise<{url: string; layer: Buffer; layerDigest: string}> {
        const seeded = await seedUpstreamImage(request, repo);
        const org = await api.organization('squidproxy');
        await api.raw.createProxyCacheConfig(org.name, {
          upstream_registry: upstream,
          expiration_s: 3600,
          insecure: true,
        });
        const token = await getV2Token(
          request,
          API_URL,
          username,
          password,
          `repository:${org.name}/${repo}:pull`,
        );
        const headers = {authorization: `Bearer ${token}`};
        const base = `${API_URL}/v2/${org.name}/${repo}`;

        const manifest = await request.get(`${base}/manifests/latest`, {
          headers: {...headers, accept: OCI_MANIFEST},
        });
        expect(manifest.status()).toBe(200);

        const blob = await request.get(`${base}/blobs/${seeded.layerDigest}`, {
          headers,
          maxRedirects: 0,
        });
        expect(blob.status()).toBe(302);
        const location = blob.headers()['location'];
        expect(location).toContain('/_upstream_proxy/');
        return {
          url: new URL(location, API_URL).toString(),
          layer: seeded.layer,
          layerDigest: seeded.layerDigest,
        };
      }

      // Quay cannot resolve registry-upstream, so only Squid can fetch it.
      const good = await upstreamProxyLocation(
        'registry-upstream:5000',
        `squid/good-${runId}`,
      );
      const goodBlob = await request.get(good.url, {maxRedirects: 0});
      expect(goodBlob.status()).toBe(200);
      expect(digestOf(await goodBlob.body())).toBe(good.layerDigest);

      const rangeBlob = await request.get(good.url, {
        headers: {range: 'bytes=1000-1999'},
        maxRedirects: 0,
      });
      expect(rangeBlob.status()).toBe(206);
      expect(rangeBlob.headers()['content-range']).toBe(
        `bytes 1000-1999/${LAYER_SIZE}`,
      );
      expect(await rangeBlob.body()).toEqual(good.layer.subarray(1000, 2000));

      // Squid refuses registry-denied blobs; Quay must answer, not hang.
      const denied = await upstreamProxyLocation(
        'registry-denied:5000',
        `squid/denied-${runId}`,
      );
      const startedAt = Date.now();
      const deniedBlob = await request.get(denied.url, {
        maxRedirects: 0,
        timeout: DENIED_BLOB_BOUND_MS * 2,
      });
      expect(Date.now() - startedAt).toBeLessThan(DENIED_BLOB_BOUND_MS);
      expect(deniedBlob.status()).toBe(502);
    });
  },
);
