import {createTestQueryClient, render, screen, userEvent} from 'src/test-utils';
import EditableLabels from './LabelsEditable';
import {getLabels} from 'src/resources/TagResource';

vi.mock('src/resources/TagResource', () => ({
  getLabels: vi.fn(),
  bulkCreateLabels: vi.fn(),
  bulkDeleteLabels: vi.fn(),
}));

it('keeps the editor closed until labels load, then keeps an added label', async () => {
  let resolveFetch: (labels: []) => void;
  vi.mocked(getLabels).mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve;
    }),
  );
  render(<EditableLabels org="o" repo="r" digest="sha256:abc" />);

  expect(screen.queryByText('Add new label')).not.toBeInTheDocument();
  resolveFetch([]);

  const user = userEvent.setup();
  await user.click(await screen.findByText('Add new label'));
  await user.type(screen.getByPlaceholderText('key=value'), 'test=value');
  await user.click(screen.getByText('Mutable labels'));

  expect(screen.getByText('test=value')).toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save Labels'})).toBeEnabled();
});

it('keeps the editor closed while refetching over cached labels', async () => {
  const existing = {id: 'a=b', key: 'a', value: 'b', source_type: 'api'};
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    ['namespace', 'o', 'repo', 'r', 'digest', 'sha256:abc', 'labels'],
    [existing],
  );
  let resolveFetch: (labels: (typeof existing)[]) => void;
  vi.mocked(getLabels).mockReturnValue(
    new Promise((resolve) => {
      resolveFetch = resolve;
    }),
  );
  render(<EditableLabels org="o" repo="r" digest="sha256:abc" />, {
    queryClient,
  });

  expect(screen.queryByText('Add new label')).not.toBeInTheDocument();
  resolveFetch([existing]);

  expect(await screen.findByText('a=b')).toBeInTheDocument();
});
