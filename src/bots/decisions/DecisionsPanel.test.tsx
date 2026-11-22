import { screen, waitFor, within } from '@testing-library/react';
import { decision, decisionsFake, precedent } from '@/test/botDecisions';
import { botsFake } from '@/test/bots';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { swarmsFake } from '@/test/swarms';
import { unescaped } from './Markdown';
import { flatFields, itemLabel } from './readable';

const many = () =>
  Array.from({ length: 30 }, (_, i) =>
    decision({
      id: `d-${i + 1}`,
      key: `m${i + 1}`,
      label: i === 0 ? 'Lunch on Friday?' : `Newsletter ${i + 1}`,
      fields: { subject: i === 0 ? 'Lunch on Friday?' : `Newsletter ${i + 1}`, from: i === 0 ? 'ada@example.com' : 'news@example.com' },
      outcome: i === 0 ? 'answer' : 'leave',
      now: i === 0 ? 'answer' : 'leave',
      who: i % 3 === 0 ? 'ada' : i % 3 === 1 ? 'you' : 'default',
      confidence: i / 30,
      at: new Date(Date.parse('2026-11-20T09:00:00Z') + i * 60_000).toISOString(),
    }),
  );

function open(decisions = many()) {
  server.use(...botsFake().handlers, ...swarmsFake({ swarms: [] }).handlers);
  const fake = decisionsFake({ decisions, precedents: [precedent(), precedent({ id: 'p-2', outcome: 'leave', similarity: 0.6, label: null })] });
  server.use(...fake.handlers);
  const view = renderApp('/bots/inbox-helper?panel=decisions');
  return { ...view, fake };
}

const table = () => screen.findByRole('table', { name: 'Every decision' });
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1);

describe('the Decisions panel', () => {
  it('lists the decisions newest first, 25 a page, with labels, gate, outcome, who, confidence and Right/Wrong', async () => {
    const { user } = open();
    const t = await table();
    await waitFor(() => expect(bodyRows(t)).toHaveLength(25));
    expect(bodyRows(t)[0]).toHaveTextContent('Newsletter 30');
    expect(bodyRows(t)[0]).toHaveTextContent('easyleave');
    expect(screen.getByRole('navigation', { name: 'Pages' })).toHaveTextContent('1–25 of 30');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(bodyRows(t)).toHaveLength(5));
    expect(screen.getByRole('navigation', { name: 'Pages' })).toHaveTextContent('26–30 of 30');
    expect(bodyRows(t).at(-1)).toHaveTextContent('Lunch on Friday?');
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(bodyRows(t)).toHaveLength(25));
  });

  it('searches, filters by chips and sorts by a column head', async () => {
    const { user, fake } = open();
    const t = await table();
    await user.type(screen.getByRole('searchbox', { name: 'Search decisions' }), 'lunch');
    await waitFor(() => expect(bodyRows(t)).toHaveLength(1));
    expect(bodyRows(t)[0]).toHaveTextContent('Lunch on Friday?');
    await user.clear(screen.getByRole('searchbox', { name: 'Search decisions' }));
    const chips = screen.getByRole('group', { name: 'Filters' });
    await user.click(within(chips).getByRole('button', { name: 'You' }));
    await waitFor(() => expect(bodyRows(t)).toHaveLength(10));
    expect(within(chips).getByRole('button', { name: 'You' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(chips).getByRole('button', { name: 'You' }));
    await user.click(within(chips).getByRole('button', { name: 'answer' }));
    await waitFor(() => expect(bodyRows(t)).toHaveLength(1));
    await user.click(within(chips).getByRole('button', { name: 'answer' }));
    await user.click(within(t).getByRole('button', { name: 'Confidence' }));
    await waitFor(() => expect(fake.state.seen.at(-1)).toContain('sort=confidence&order=desc'));
    await user.click(within(t).getByRole('button', { name: /Confidence/ }));
    await waitFor(() => expect(fake.state.seen.at(-1)).toContain('sort=confidence&order=asc'));
    expect(within(t).getByRole('columnheader', { name: /Confidence/ })).toHaveAttribute('aria-sort', 'ascending');
    await waitFor(() => expect(bodyRows(t)[0]).toHaveTextContent('Lunch on Friday?'));
    await user.click(within(chips).getByRole('button', { name: 'Corrected' }));
    expect(await screen.findByText('No decision matches.')).toBeInTheDocument();
  });

  it('relabels the chosen rows together, and says they were right', async () => {
    const { user, fake } = open();
    const t = await table();
    await waitFor(() => expect(bodyRows(t)).toHaveLength(25));
    await user.click(within(t).getByRole('checkbox', { name: 'Choose Newsletter 30' }));
    await user.click(within(t).getByRole('checkbox', { name: 'Choose Newsletter 29' }));
    const bulk = screen.getByRole('region', { name: 'Chosen decisions' });
    expect(bulk).toHaveTextContent('2 chosen');
    await user.click(within(bulk).getByRole('button', { name: 'answer' }));
    await waitFor(() => expect(fake.state.bodies.at(-1)).toEqual({ ids: ['d-30', 'd-29'], outcome: 'answer' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Chosen decisions' })).not.toBeInTheDocument());
    await waitFor(() => expect(bodyRows(t)[0]).toHaveTextContent('Newsletter 30easyleaveanswer'));
    await user.click(within(t).getByRole('checkbox', { name: 'Choose every decision on this page' }));
    await user.click(within(screen.getByRole('region', { name: 'Chosen decisions' })).getByRole('button', { name: 'All right' }));
    await waitFor(() => expect(fake.state.seen.some((s) => /^confirm d-30,d-29,/.test(s))).toBe(true));
  });

  it('trains one row with Right, or Wrong and what it should be', async () => {
    const { user, fake } = open();
    const t = await table();
    await waitFor(() => expect(bodyRows(t)).toHaveLength(25));
    await user.click(within(bodyRows(t)[0]!).getByRole('button', { name: 'Right: Newsletter 30' }));
    await waitFor(() => expect(fake.state.seen).toContain('confirm d-30'));
    await waitFor(() => expect(within(bodyRows(t)[0]!).getByRole('button', { name: 'Right: Newsletter 30' })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(within(bodyRows(t)[1]!).getByRole('button', { name: 'Wrong: Newsletter 29' }));
    await user.click(await screen.findByRole('menuitem', { name: 'It should be answer' }));
    await waitFor(() => expect(fake.state.seen).toContain('relabel d-29'));
  });

  it('opens a row in a drawer: its fields, who decided, and its nearest precedents, each one forgettable', async () => {
    const { user, fake } = open();
    const t = await table();
    await waitFor(() => expect(bodyRows(t)).toHaveLength(25));
    await user.click(within(t).getByRole('button', { name: 'Newsletter 28' }));
    const drawer = await screen.findByRole('dialog', { name: 'Newsletter 28' });
    expect(drawer).toHaveTextContent('Gate easy');
    expect(within(drawer).getByText('from')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('news@example.com');
    const near = await within(drawer).findByRole('list', { name: 'Nearest precedents' });
    expect(within(near).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Coffee next week?answerForget', 'Precedent p-2leaveForget']);
    await user.click(within(near).getByRole('button', { name: 'Forget Coffee next week?' }));
    await waitFor(() => expect(fake.state.seen).toContain('forget p-1'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Newsletter 28' })).not.toBeInTheDocument();
  });

  it('says so when the bot has no decisions yet', async () => {
    open([]);
    expect(await screen.findByText('No decisions yet: its gates decide when it runs.')).toBeInTheDocument();
  });
});

describe('readable data', () => {
  it('titles an item from its fields, never as JSON, and gives written-out line breaks back', () => {
    expect(itemLabel({ id: 7, title: 'Fix   the\nbug' })).toBe('Fix the bug');
    expect(itemLabel({ id: 7, repo: 'glyphh', n: 3 })).toBe('repo glyphh · n 3');
    expect(itemLabel({ id: 7 })).toBe('An item with no fields');
    expect(itemLabel([1, 2])).toBe('2 items');
    expect(itemLabel(null)).toBe('Nothing');
    expect(flatFields({ user: { login: 'ada' }, labels: ['a', 'b'], empty: '' })).toEqual([
      ['user.login', 'ada'],
      ['labels', 'a, b'],
    ]);
    expect(unescaped('one\\ntwo')).toBe('one\ntwo');
    expect(unescaped('one\ntwo \\n')).toBe('one\ntwo \\n');
  });
});
