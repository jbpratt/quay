import {renderHook, act, waitFor} from '@testing-library/react';
import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createTestQueryClient} from 'src/test-utils';
import {useLabels} from './UseTagLabels';
import {
  Label,
  getLabels,
  bulkCreateLabels,
  bulkDeleteLabels,
} from 'src/resources/TagResource';

vi.mock('src/resources/TagResource', () => ({
  getLabels: vi.fn(),
  bulkCreateLabels: vi.fn(),
  bulkDeleteLabels: vi.fn(),
}));

vi.mock('src/resources/ErrorHandling', () => ({
  ResourceError: class ResourceError extends Error {},
  BulkOperationError: class BulkOperationError extends Error {},
}));

/** QueryClientProvider wrapper for hooks that use React Query. */
function wrapper({children}: {children: React.ReactNode}) {
  const [queryClient] = React.useState(() => createTestQueryClient());
  return React.createElement(
    QueryClientProvider,
    {client: queryClient},
    children,
  );
}

describe('useLabels', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('fetches labels for a digest', async () => {
    const mockLabels = [
      {key: 'version', value: '1.0', mediatype: 'text/plain'},
    ];
    vi.mocked(getLabels).mockResolvedValueOnce(mockLabels as any);
    const {result} = renderHook(
      () => useLabels('myorg', 'myrepo', 'sha256:abc'),
      {wrapper},
    );
    await waitFor(() => expect(result.current.labels).toEqual(mockLabels));
  });

  it('reports labels unfetched until this mount fetches them', async () => {
    // A client that keeps the first mount's data cached, as the app's does.
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
    const cachedWrapper = ({children}: {children: React.ReactNode}) =>
      React.createElement(QueryClientProvider, {client: queryClient}, children);
    const pendingLabels = () => {
      let resolve: (labels: Label[]) => void;
      vi.mocked(getLabels).mockReturnValueOnce(
        new Promise<Label[]>((r) => {
          resolve = r;
        }),
      );
      return (labels: Label[]) => resolve(labels);
    };
    const cached = [
      {id: 'k=v', key: 'k', value: 'v', source_type: 'api', media_type: null},
    ];

    const resolveFirst = pendingLabels();
    const first = renderHook(() => useLabels('myorg', 'myrepo', 'sha256:abc'), {
      wrapper: cachedWrapper,
    });
    expect(first.result.current.loading).toBe(false);
    expect(first.result.current.isFetchedAfterMount).toBe(false);
    act(() => resolveFirst(cached));
    await waitFor(() =>
      expect(first.result.current.isFetchedAfterMount).toBe(true),
    );
    first.unmount();

    const resolveReopen = pendingLabels();
    const reopen = renderHook(
      () => useLabels('myorg', 'myrepo', 'sha256:abc'),
      {wrapper: cachedWrapper},
    );
    expect(reopen.result.current.initialLabels).toEqual(cached);
    expect(reopen.result.current.isFetchedAfterMount).toBe(false);
    act(() => resolveReopen(cached));
    await waitFor(() =>
      expect(reopen.result.current.isFetchedAfterMount).toBe(true),
    );
  });

  it('calls bulkCreateLabels on createLabels mutate', async () => {
    vi.mocked(getLabels).mockResolvedValueOnce([]);
    vi.mocked(bulkCreateLabels).mockResolvedValueOnce(undefined);
    const {result} = renderHook(
      () => useLabels('myorg', 'myrepo', 'sha256:abc'),
      {wrapper},
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const newLabel = {key: 'env', value: 'prod', mediatype: 'text/plain'};
    act(() => {
      result.current.createLabels([newLabel] as any);
    });
    await waitFor(() =>
      expect(result.current.successCreatingLabels).toBe(true),
    );
    expect(bulkCreateLabels).toHaveBeenCalledWith(
      'myorg',
      'myrepo',
      'sha256:abc',
      [newLabel],
    );
  });

  it('calls bulkDeleteLabels on deleteLabels mutate', async () => {
    vi.mocked(getLabels).mockResolvedValueOnce([]);
    vi.mocked(bulkDeleteLabels).mockResolvedValueOnce(undefined);
    const {result} = renderHook(
      () => useLabels('myorg', 'myrepo', 'sha256:abc'),
      {wrapper},
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.deleteLabels([{key: 'env', value: 'prod'}] as any);
    });
    await waitFor(() =>
      expect(result.current.successDeletingLabels).toBe(true),
    );
  });
});
