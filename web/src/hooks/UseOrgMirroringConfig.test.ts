import {renderHook, act, waitFor} from '@testing-library/react';
import {TestWrapper} from 'src/test-utils';
import {useOrgMirroringConfig} from './UseOrgMirroringConfig';
import {
  getOrgMirrorConfig,
  cancelOrgMirrorSync,
  OrgMirrorConfig,
} from 'src/resources/OrgMirrorResource';

vi.mock('src/resources/OrgMirrorResource', () => ({
  getOrgMirrorConfig: vi.fn(),
  createOrgMirrorConfig: vi.fn(),
  updateOrgMirrorConfig: vi.fn(),
  syncOrgMirrorNow: vi.fn(),
  cancelOrgMirrorSync: vi.fn(),
  verifyOrgMirrorConnection: vi.fn(),
}));

vi.mock('src/resources/UserResource', () => ({
  EntityKind: {user: 'user', team: 'team'},
}));

const baseConfig: OrgMirrorConfig = {
  is_enabled: true,
  external_registry_type: 'harbor',
  external_registry_url: 'harbor.example.com',
  external_namespace: 'namespace',
  external_registry_username: 'user',
  has_external_registry_password: true,
  external_registry_config: {
    verify_tls: true,
    proxy: {http_proxy: null, https_proxy: null, no_proxy: null},
  },
  repository_filters: [],
  robot_username: 'org+bot',
  visibility: 'private',
  sync_interval: 3600,
  sync_start_date: '2026-01-01T00:00:00Z',
  sync_expiration_date: null,
  sync_status: 'SYNCING',
  sync_retries_remaining: 3,
  repo_sync_status_counts: {},
  skopeo_timeout: 300,
  creation_date: null,
};

describe('useOrgMirroringConfig cancel sync', () => {
  const mockReset = vi.fn();
  const mockSetSelectedRobot = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rethrows when cancelOrgMirrorSync rejects', async () => {
    vi.mocked(getOrgMirrorConfig).mockResolvedValue(baseConfig);
    vi.mocked(cancelOrgMirrorSync).mockRejectedValueOnce(
      new Error('cancel failed'),
    );

    const {result} = renderHook(
      () => useOrgMirroringConfig('myorg', mockReset, mockSetSelectedRobot),
      {wrapper: TestWrapper},
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.handleCancelSync();
      }),
    ).rejects.toThrow('cancel failed');

    expect(result.current.isCancellingSync).toBe(false);
  });

  it('resolves when cancelOrgMirrorSync succeeds', async () => {
    vi.mocked(getOrgMirrorConfig).mockResolvedValue(baseConfig);
    vi.mocked(cancelOrgMirrorSync).mockResolvedValueOnce(undefined);

    const {result} = renderHook(
      () => useOrgMirroringConfig('myorg', mockReset, mockSetSelectedRobot),
      {wrapper: TestWrapper},
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.handleCancelSync();
      }),
    ).resolves.toBeUndefined();
  });
});
