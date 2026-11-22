import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { decision, decisionsFake } from '@/test/botDecisions';
import { botsFake, drafted, drawnMascot, inbox, waiting, weekdays } from '@/test/bots';
import { renderApp } from '@/test/render';
import { http, HttpResponse, server } from '@/test/server';
import { closing, picking, projectRun, projectsFake, siteCrew, turn } from '@/test/projects';
import { CLOUD_NOTE } from '@/pages/projects/parts';
import { safeHref, md } from './md';

/** The org's bots and connections, and its projects (none unless given). */
function on(given?: Parameters<typeof botsFake>[0], given2: Parameters<typeof projectsFake>[0] = { projects: [] }) {
  const fake = botsFake(given);
  const projects = projectsFake(given2);
  server.use(...fake.handlers, ...projects.handlers);
  return Object.assign(fake, { projects });
}

const crewBots = { bots: [inbox(), inbox({ id: 'b-digest', slug: 'digest', name: 'Digest' })] };

const decided = () =>
  waiting({
    id: 'r-done',
    status: 'done',
    input: 'Morning',
    output: 'Answered **1** email.',
    question: null,
    data: {
      _gates: { easy: { each: true, outcome: 'answer 1, leave 1', by: 'ada', asked: 1, decided: 1, defaulted: 0 } },
      decide: {
        decisions: [
          { n: 1, label: 'Lunch on Friday?', outcome: 'answer', by: 'ada', p: 0.97 },
          { n: 2, label: 'Invoice overdue', outcome: 'leave', by: 'person' },
        ],
      },
    },
    finished_at: '2026-11-20T09:01:00Z',
  });

describe('the Bots area, as the Glyphh Bot app', () => {
  it('has the rail (BOTS | CONNECTIONS, the bots, New bot, the account), the chat and the status bar, with the logo as the image', async () => {
    on({ bots: [inbox(), inbox({ id: 'b-2', slug: 'quiet', name: 'Quiet', summary: 'Says little.', gate_models: [] })], runs: [waiting()] });
    renderApp('/bots');
    const rail = await screen.findByRole('complementary', { name: 'Bots and connections' });
    expect(within(rail).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Bots', 'Connections']);
    expect(within(rail).getByRole('tab', { name: 'Bots' })).toHaveAttribute('aria-selected', 'true');
    const bots = await within(rail).findByRole('navigation', { name: 'Your bots' });
    await waitFor(() => expect(within(bots).getAllByRole('link')).toHaveLength(2));
    const [helper, quiet] = within(bots).getAllByRole('link');
    // A round cat, the name with its small tag, and a line: what it is for, or that it needs you.
    expect(helper).toHaveTextContent('Inbox helper 1 gate');
    await waitFor(() => expect(helper).toHaveTextContent('Needs you'));
    expect(quiet).toHaveTextContent('Quiet Says little.');
    // With no project, the first bot is the room.
    expect(helper).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('button', { name: '+ New bot' })).toBeInTheDocument();
    expect(await within(rail).findByRole('button', { name: 'Your account' })).toHaveTextContent('chris@example.com');
    expect(within(screen.getByRole('banner')).getByRole('img', { name: 'Glyphh' })).toHaveAttribute('src', '/glyphh-logo-text-white.png');
    const status = screen.getByRole('contentinfo');
    await waitFor(() => expect(status).toHaveTextContent('Connectors 2'));
    expect(status).toHaveTextContent('Glyphh connected');
    expect(status).toHaveTextContent('Permissions Ask first');
    expect(status).toHaveTextContent('Runs on Glyphh cloud');
    // The product nav stays, with Bots in it; no breadcrumb bar, no page tabs.
    expect(within(screen.getByRole('complementary', { name: 'Main' })).getByRole('link', { name: 'Bots' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('opens a bot with nothing said yet on its cat, a headline, ideas and the composer with its pills', async () => {
    const fake = on({ bots: [inbox({ runs_on: 'rr-acme', schedule: weekdays() })] });
    const { user } = renderApp('/bots/inbox-helper');
    expect(await screen.findByRole('heading', { name: 'What should Inbox helper do?', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'is:unread' })).toBeInTheDocument(); // an idea: what its schedule gives it
    expect(screen.getByRole('textbox', { name: 'Give Inbox helper a task…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    // The pills: Ada, runs on, model, permission mode, schedule. No rounds.
    expect(screen.getByRole('button', { name: /Ada · 1 gate/ })).toBeInTheDocument();
    const where = screen.getByRole('combobox', { name: 'Runs on' });
    await waitFor(() => expect(within(where).getAllByRole('option')).toHaveLength(3));
    expect(within(where).getAllByRole('option').map((o) => o.textContent)).toEqual(['Glyphh cloud', 'Studio Mac', 'Acme (offline)']);
    expect(where).toHaveValue('rr-acme');
    expect(screen.getByText(/Acme is offline/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Schedule' })).toHaveValue('weekdays');
    expect(screen.queryByText(/round/i)).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Model' })).getAllByRole('option').length).toBeGreaterThan(3));
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('claude-sonnet-5-5');
    // The server's refusal is said under the composer.
    await user.type(screen.getByRole('textbox', { name: 'Give Inbox helper a task…' }), 'Clear the inbox.{Enter}');
    expect(await screen.findByText(/Acme is not linked to Glyphh right now/)).toBeInTheDocument();
    // A pill changes the bot there and then.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Permission mode' }), 'auto');
    await waitFor(() => expect(fake.state.bodies[0]).toEqual({ permission_mode: 'auto' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Runs on' }), '');
    await waitFor(() => expect(fake.state.bodies[1]).toEqual({ runs_on: null }));
  });

  it('runs a bot as a conversation: the task on the right, the bot’s turn, and what it asks answered in place', async () => {
    const fake = on();
    const { user } = renderApp('/bots/inbox-helper');
    await user.type(await screen.findByRole('textbox', { name: 'Give Inbox helper a task…' }), 'Clear the inbox.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const turn = await screen.findByRole('article', { name: /^Inbox helper:/ });
    expect(screen.getByText('Clear the inbox.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What should Inbox helper do?' })).not.toBeInTheDocument();
    const question = await screen.findByRole('region', { name: 'Question' }, { timeout: 6000 });
    expect(screen.getByRole('article', { name: 'Inbox helper: Needs you' })).toBeInTheDocument();
    expect(question).toHaveTextContent('Inbox helper asks');
    expect(question).toHaveTextContent('Answer these emails?');
    // Its steps fold into one line.
    await user.click(within(turn).getByRole('button', { name: 'Ran 2 steps' }));
    expect(within(turn).getByLabelText('Steps')).toHaveTextContent('Found 2 emails.');
    const send = within(question).getByRole('button', { name: 'Send answers' });
    expect(send).toBeDisabled();
    await user.click(within(question).getByRole('button', { name: 'All answer' }));
    await user.click(within(within(question).getByRole('radiogroup', { name: 'Invoice overdue' })).getByRole('radio', { name: 'leave' }));
    expect(within(within(question).getByRole('radiogroup', { name: 'Lunch on Friday?' })).getByRole('radio', { name: 'answer' })).toHaveAttribute('aria-checked', 'true');
    await user.click(send);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Inbox helper: done' })).toHaveTextContent('Answered 1 email.'));
    expect(fake.state.bodies.at(-1)).toEqual({ '1': 'answer', '2': 'leave' });
    expect(fake.state.seen).toContain('run inbox-helper');
  }, 12_000);

  it('answers a one-option question with a button, and cancels a waiting run', async () => {
    const fake = on({
      runs: [
        waiting({ id: 'r-1', question: { question: 'Send the reply?', options: ['yes', 'no'], batch: null, answer_with: null } }),
        waiting({ id: 'r-2', input: 'Second', created_at: '2026-11-19T09:00:00Z' }),
      ],
    });
    const { user } = renderApp('/bots/inbox-helper');
    const questions = await screen.findAllByRole('region', { name: 'Question' });
    // Oldest first, as a chat reads: the newest run is the last turn.
    expect(questions.map((q) => q.querySelector('.ask-q')!.textContent)).toEqual(['Answer these emails?', 'Send the reply?']);
    await user.click(within(questions[1]!).getByRole('button', { name: 'yes' }));
    await waitFor(() => expect(fake.state.seen).toContain('answer r-1'));
    expect(fake.state.bodies.at(-1)).toBe('yes');
    await user.click(within(screen.getByRole('region', { name: 'Question' })).getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(fake.state.seen).toContain('cancel r-2'));
    expect(await screen.findByRole('article', { name: 'Inbox helper: cancelled' })).toBeInTheDocument();
  });

  it('shows what Ada decided as rows in the bot’s turn: the item, the outcome, who decided, Right or Wrong', async () => {
    const fake = on({ runs: [decided()] });
    const { user } = renderApp('/bots/inbox-helper');
    const table = await screen.findByRole('table', { name: 'Decisions' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['1Lunch on Friday?answerAda · 97% sureRightWrong', '2Invoice overdueleaveYouRightWrong']);
    expect(screen.getByRole('article', { name: 'Inbox helper: done' })).toHaveTextContent('Answered 1 email.');
    // Right keeps it; Wrong, with one other outcome, says that one, and the gate learns it.
    await user.click(within(rows[1]!).getByRole('button', { name: 'Right: easy item 2' }));
    expect(rows[1]).toHaveTextContent('Kept');
    await user.click(within(rows[0]!).getByRole('button', { name: 'Wrong: easy item 1' }));
    await waitFor(() => expect(rows[0]).toHaveTextContent('1Lunch on Friday?leaveYouAda learned it'));
    expect(fake.state.bodies.at(-1)).toEqual({ outcome: 'leave', gate: 'easy', item: '1' });
  });

  it('shows the server’s decisions in the turn once it has them: Right keeps one in Ada, Wrong relabels it', async () => {
    on({ runs: [decided()] });
    const fake = decisionsFake({
      decisions: [decision(), decision({ id: 'd-2', key: 'm2', label: 'Invoice overdue', outcome: 'leave', now: 'leave', who: 'you', confidence: null })],
    });
    server.use(...fake.handlers);
    const { user } = renderApp('/bots/inbox-helper');
    // The run's own rows first, then the server's (labels from the items, never JSON), in a table of their own.
    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: 'Decisions' })).getAllByRole('row').map((r) => r.textContent)).toEqual([
        'Lunch on Friday?answerAda · 97% sureRightWrong',
        'Invoice overdueleaveYouRightWrong',
      ]),
    );
    const table = screen.getByRole('table', { name: 'Decisions' });
    const rows = within(table).getAllByRole('row');
    // A run that spent tokens says how many, beside its cost.
    expect(screen.getByRole('article', { name: 'Inbox helper: done' })).toHaveTextContent('1,020 tokens · $0.0042');
    await user.click(within(rows[1]!).getByRole('button', { name: 'Right: Invoice overdue' }));
    await waitFor(() => expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Kept'));
    expect(fake.state.seen).toContain('confirm d-2');
    await user.click(within(within(table).getAllByRole('row')[0]!).getByRole('button', { name: 'Wrong: Lunch on Friday?' }));
    await waitFor(() => expect(within(table).getAllByRole('row')[0]).toHaveTextContent('Lunch on Friday?leaveYouAda learned it'));
    expect(fake.state.bodies.at(-1)).toEqual({ outcome: 'leave' });
  });

  it('reads a run’s steps readably, raw JSON behind a toggle, and says when no Claude step ran', async () => {
    const run = { ...decided(), input_tokens: 0, output_tokens: 0, cost_micros: 0 };
    run.output = 'Line one\\nLine **two**';
    run.data = {
      ...run.data,
      mail: { exports: { $summary: 'Found 2 emails' }, ret: [{ id: 'm1', subject: 'Lunch on Friday?' }, { id: 'm2', subject: 'Invoice overdue', html_url: 'https://mail.test/m2' }] },
    };
    on({ runs: [run] });
    const { user } = renderApp('/bots/inbox-helper');
    const turn = await screen.findByRole('article', { name: 'Inbox helper: done' });
    // The output's written-out line breaks are breaks again; no tokens and no agent step: it says so, not $0.00.
    expect(within(turn).getByText('two').closest('.md')).toHaveTextContent('Line oneLine two');
    expect(turn).toHaveTextContent('No Claude step ran');
    await user.click(within(turn).getByRole('button', { name: 'What its steps found' }));
    const step = within(turn).getByRole('region', { name: 'Step mail' });
    expect(step).toHaveTextContent('Found 2 emails');
    expect(within(step).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lunch on Friday?', 'Invoice overdue']);
    expect(within(step).getByRole('link', { name: 'Invoice overdue' })).toHaveAttribute('href', 'https://mail.test/m2');
    expect(within(turn).getByRole('region', { name: 'Step decide' })).toHaveTextContent('2 decided');
    expect(turn.querySelector('pre.rraw')).toBeNull();
    await user.click(within(turn).getByRole('button', { name: 'Raw' }));
    expect(turn.querySelector('pre.rraw')).toHaveTextContent('"$summary": "Found 2 emails"');
  });

  it('opens Decisions, Ada gates and Tools as panels beside the chat from the top bar’s icons, not as tabs', async () => {
    on({ runs: [decided()] });
    server.use(...decisionsFake({ decisions: [decision(), decision({ id: 'd-2', key: 'm2', label: 'Invoice overdue', outcome: 'leave', now: 'leave', who: 'you' })] }).handlers);
    const { user, router } = renderApp('/bots/inbox-helper');
    const panels = await screen.findByRole('toolbar', { name: 'Panels' });
    expect(within(panels).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Decisions', 'Ada gates', 'Tools']);
    expect(screen.queryByRole('region', { name: 'Decisions' })).not.toBeInTheDocument();
    await user.click(within(panels).getByRole('button', { name: 'Decisions' }));
    const decisions = await screen.findByRole('region', { name: 'Decisions' });
    const every = within(decisions).getByRole('table', { name: 'Every decision' });
    await waitFor(() => expect(within(every).getAllByRole('row')).toHaveLength(3));
    await user.click(within(panels).getByRole('button', { name: 'Ada gates' }));
    const gates = await screen.findByRole('region', { name: 'Ada gates' });
    expect(await within(gates).findByText('precedents')).toBeInTheDocument();
    expect(gates).toHaveTextContent('Ada decided 8 · you 6');
    expect(router.state.location.search).toBe('?panel=decisions%2Cgates');
    // The chat is still there beside them.
    expect(screen.getByRole('textbox', { name: 'Give Inbox helper a task…' })).toBeInTheDocument();
    await user.click(within(decisions).getByRole('button', { name: 'Close Decisions' }));
    expect(screen.queryByRole('region', { name: 'Decisions' })).not.toBeInTheDocument();
    await user.click(within(panels).getByRole('button', { name: 'Tools' }));
    const tools = await screen.findByRole('region', { name: 'Tools' });
    expect(within(tools).getByText('bot_run_wrong')).toBeInTheDocument();
    expect(await within(tools).findByRole('heading', { name: 'Gmail · chris@example.com' })).toBeInTheDocument();
  });

  it('lands an old link to a bot’s tab: its gates as a panel, its settings as the editor', async () => {
    on();
    renderApp('/bots/inbox-helper?tab=gates');
    expect(await screen.findByRole('region', { name: 'Ada gates' })).toBeInTheDocument();
    // What used to open the editor's Advanced part opens the one editor there is.
    for (const old of ['?tab=loop', '?edit=advanced']) {
      const view = renderApp(`/bots/inbox-helper${old}`);
      const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
      expect(within(editor).getByLabelText('Instructions')).toBeVisible();
      expect(editor.querySelector('details')).toBeNull();
      view.unmount();
    }
  });

  it('lists past runs under Recents, shows one in the chat, and starts a new chat from the empty state', async () => {
    on({ runs: [decided(), waiting({ id: 'r-old', status: 'done', input: 'Yesterday', question: null, created_at: '2026-11-19T09:00:00Z' })] });
    const { user, router } = renderApp('/bots/inbox-helper');
    await user.click(await screen.findByRole('button', { name: /Recents/ }));
    const recents = screen.getByRole('dialog', { name: 'Recents' });
    await waitFor(() => expect(within(recents).getAllByRole('button').map((b) => b.textContent)).toEqual([' New chat', expect.stringMatching(/^MorningInbox helper · /), expect.stringMatching(/^YesterdayInbox helper · /)]));
    await user.click(within(recents).getByRole('button', { name: /Yesterday/ }));
    expect(router.state.location.search).toBe('?run=r-old');
    await user.click(screen.getByRole('button', { name: /Recents/ }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'What should Inbox helper do?' })).toBeInTheDocument();
  });

  it('shows the org’s connections under CONNECTIONS, and a connection’s tools as a panel', async () => {
    const fake = on();
    const { user } = renderApp('/bots');
    await user.click(await screen.findByRole('tab', { name: 'Connections' }));
    const rail = screen.getByRole('complementary', { name: 'Bots and connections' });
    const gmail = await within(rail).findByRole('button', { name: /Gmail/ });
    expect(gmail).toHaveTextContent('Gmailon');
    expect(within(rail).getByRole('button', { name: /Slack/ })).toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: '+ Add connectors' })).toHaveAttribute('href', '/connections');
    expect(within(rail).getByText('Glyphh’s key')).toBeInTheDocument();
    await user.click(within(rail).getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(fake.state.seen.some((s) => s.startsWith('sync'))).toBe(true));
    await user.click(gmail);
    const tools = await screen.findByRole('region', { name: 'Gmail · tools' });
    expect(await within(tools).findByText(/Read-only tools/)).toBeInTheDocument();
  });

  it('says when there is no such bot, and what a bot is when the org has none', async () => {
    on();
    renderApp('/bots/nope');
    expect(await screen.findByText('There is no such bot')).toBeInTheDocument();
    server.resetHandlers();
    on({ bots: [] });
    const { user } = renderApp('/bots');
    expect(await screen.findByRole('heading', { name: 'Make your first bot' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a ready-made one' })).toHaveAttribute('href', '/marketplace/bots');
    await user.click(screen.getAllByRole('button', { name: '+ New bot' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'New bot' })).toBeInTheDocument();
  });
});

describe('a project’s crew in the Bots area', () => {
  it('is a crew card in the rail, opens on "What are we making?", and runs as turns with their pull requests', async () => {
    const fake = on({ bots: [inbox(), inbox({ id: 'b-digest', slug: 'digest', name: 'Digest' })] }, {});
    const { user } = renderApp('/bots');
    const rail = await screen.findByRole('complementary', { name: 'Bots and connections' });
    const card = await within(rail).findByRole('link', { name: /Site crew/ });
    expect(card).toHaveTextContent('Site crew2 bots, taking turns');
    expect(card).toHaveAttribute('aria-current', 'page'); // a project's crew is the room first
    expect(await screen.findByRole('heading', { name: 'What are we making?', level: 1 })).toBeInTheDocument();
    // The crew strip on top: the cats with their names.
    expect(within(screen.getByLabelText('The crew')).getAllByText(/Inbox helper|Digest/).map((s) => s.textContent)).toEqual(['Inbox helper', 'Digest']);
    expect(screen.getByTitle('The project’s repo')).toHaveTextContent('sitemain');
    expect(screen.queryByRole('combobox', { name: /round/i })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Give the crew a task…' }), 'Make the home page.{Enter}');
    const turn = await screen.findByRole('article', { name: 'Inbox helper: turn 1' });
    expect(screen.getByText('Make the home page.')).toBeInTheDocument();
    const merge = await within(turn).findByRole('button', { name: 'Merge' }, { timeout: 8000 });
    expect(turn).toHaveTextContent('PR #41');
    expect(within(screen.getByLabelText('Turns')).getByRole('button')).toHaveTextContent('1 Inbox helper #41 open');
    await user.click(merge);
    await waitFor(() => expect(fake.projects.state.bodies.at(-1)).toBe('merge'));
    await waitFor(() => expect(within(screen.getByLabelText('Turns')).getAllByRole('button')[0]).toHaveTextContent('#41 merged'));
    // The rail makes a project too, and the top bar's edit goes to the project's own page.
    expect(within(rail).getByRole('link', { name: 'new project' })).toHaveAttribute('href', '/projects?new=1');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Edit Site crew' })).toHaveAttribute('href', '/projects/site-crew');
  }, 15_000);

  it('sets where it runs (Glyphh cloud first, with its note), the turn mode and the review from the composer’s pills', async () => {
    const fake = on(crewBots, {});
    const { user } = renderApp('/bots?crew=site-crew');
    const where = await screen.findByRole('combobox', { name: 'Runs on' });
    await waitFor(() => expect(within(where).getAllByRole('option').map((o) => o.textContent)).toEqual(['Glyphh cloud', 'Studio Mac', 'Acme (offline)']));
    expect(where).toHaveValue('rr-studio');
    expect(within(where).getByRole('option', { name: 'Acme (offline)' })).toBeDisabled();
    expect(screen.queryByText(CLOUD_NOTE)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Runs on' }), 'Glyphh cloud');
    expect(await screen.findByText(CLOUD_NOTE)).toBeInTheDocument();
    expect(CLOUD_NOTE).toBe(
      "Glyphh cloud has fewer tools than a rrotor: bots can read and change files and open pull requests, but can't run commands, tests or a browser. Choose a rrotor for those.",
    );
    await waitFor(() => expect(screen.getByRole('contentinfo')).toHaveTextContent('Runs on Glyphh cloud'));

    const mode = screen.getByRole('combobox', { name: 'Turn mode' });
    expect(within(mode).getAllByRole('option').map((o) => o.textContent)).toEqual(['Wait your turn', 'Orchestrator: Claude', 'Orchestrator: Inbox helper', 'Orchestrator: Digest']);
    expect(mode).toHaveValue('wait');
    await waitFor(() => expect(mode).toBeEnabled());
    await user.selectOptions(mode, 'Orchestrator: Digest');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Turn mode' })).toHaveValue('orchestrator:b-digest'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Turn mode' })).toBeEnabled());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Turn mode' }), 'Orchestrator: Claude');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Turn mode' })).toHaveValue('orchestrator:'));

    const review = screen.getByRole('combobox', { name: 'Pull requests' });
    expect(within(review).getAllByRole('option').map((o) => o.textContent)).toEqual(['Each turn', 'At the end']);
    await waitFor(() => expect(review).toBeEnabled());
    await user.selectOptions(review, 'end');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Pull requests' })).toHaveValue('end'));
    expect(fake.projects.state.bodies).toEqual([
      { runs_on: null },
      { turn_mode: 'orchestrator', orchestrator: 'b-digest' },
      { turn_mode: 'orchestrator', orchestrator: null },
      { review: 'end' },
    ]);
    expect(screen.queryByRole('combobox', { name: /round/i })).not.toBeInTheDocument();
  });

  it('shows who the orchestrator chose and why, and that it is choosing the next', async () => {
    on(crewBots, {
      projects: [siteCrew({ turn_mode: 'orchestrator' })],
      runs: [projectRun({ status: 'running', turn_mode: 'orchestrator', turns: [turn(1, { status: 'merged', picked_by: 'orchestrator', why: 'The home page comes first.' }), picking(2)] })],
    });
    renderApp('/bots?crew=site-crew');
    expect(await screen.findByText('Orchestrator chose Inbox helper · The home page comes first.')).toBeInTheDocument();
    expect(screen.getByText('Choosing who goes next…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('article', { name: 'Inbox helper: turn 1' })).toHaveTextContent('PR #41');
    // The one being picked has no chip yet.
    expect(within(screen.getByLabelText('Turns')).getAllByRole('button').map((b) => b.textContent)).toEqual(['1 Inbox helper #41 merged']);
    expect(screen.getByRole('combobox', { name: 'Turn mode' })).toHaveValue('orchestrator:');
  });

  it('with review at the end, shows the run’s one pull request of it all and merges it', async () => {
    const fake = on(crewBots, {
      projects: [siteCrew({ review: 'end' })],
      runs: [projectRun({ review: 'end', work_branch: 'run-pr-1-k3x9', pr_url: 'https://github.com/acme/site/pull/50', number: 50, turns: [turn(1, { status: 'merged' }), turn(2, { status: 'merged' })] })],
    });
    const { user } = renderApp('/bots?crew=site-crew');
    const whole = await screen.findByRole('region', { name: 'The run’s pull request' });
    expect(whole).toHaveTextContent('PR #50');
    expect(within(whole).getByText('Merge the whole run?')).toBeInTheDocument();
    expect(within(whole).getByRole('link', { name: 'https://github.com/acme/site/pull/50' })).toBeInTheDocument();
    expect(within(whole).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Inbox helper: turn 1' })).queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();
    await user.click(within(whole).getByRole('button', { name: 'Merge' }));
    expect(await screen.findByText("The crew said it's done")).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'The run’s pull request' })).not.toBeInTheDocument();
    expect(fake.projects.state.bodies).toEqual(['merge']);
  });

  it('shows the orchestrator’s closing turn, a turn with no changes and why the run ended, and starts a run with no task', async () => {
    const fake = on(crewBots, {
      projects: [siteCrew({ runs_on: null, turn_mode: 'orchestrator' })],
      runs: [
        projectRun({
          task: '',
          status: 'done',
          ended: 'orchestrator',
          runs_on: null,
          turn_mode: 'orchestrator',
          turns: [
            turn(1, { status: 'merged', picked_by: 'orchestrator' }),
            turn(2, { status: 'unchanged', picked_by: 'orchestrator', said: '', pr_url: null, number: null, files: [], done: false }),
            closing(3, 'Everything in PROJECT.md is built.'),
          ],
        }),
      ],
    });
    const { user } = renderApp('/bots?crew=site-crew');
    expect(await screen.findByText('(from the instructions)')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Digest: turn 2' })).toHaveTextContent('passed · no changes');
    expect(screen.getByRole('article', { name: 'Orchestrator: turn 3' })).toHaveTextContent('Everything in PROJECT.md is built.');
    expect(screen.getByText("The orchestrator said it's done")).toBeInTheDocument();
    expect(within(screen.getByLabelText('Turns')).getAllByRole('button').map((b) => b.textContent)).toEqual(['1 Inbox helper #41 merged', '2 Digest no changes', '3 Orchestrator done']);
    expect(screen.getByText(CLOUD_NOTE)).toBeInTheDocument();
    // Nothing typed: Send starts a run from the instructions alone.
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fake.projects.state.bodies).toEqual([{ task: '' }]));
  });
});

describe('the bot editor, a modal as the Glyphh Bot app’s', () => {
  it('edits a bot in plain fields, with nothing of how it works inside: no look pickers, no Advanced, no JSON, no skills', async () => {
    const fake = on();
    const { user, router } = renderApp('/bots/inbox-helper');
    await user.click(await within(await screen.findByRole('banner')).findByRole('button', { name: 'Edit Inbox helper' }));
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    // The card: the cat, Shuffle (one of the cats there are) and Describe a new one. Nothing else about the look.
    expect(within(editor).getByRole('button', { name: 'Shuffle the cat' })).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Describe a new one' })).toBeInTheDocument();
    expect(within(editor).queryByLabelText(/^Look/)).not.toBeInTheDocument();
    for (const label of ['Tell Claude what to change', 'Name', 'What it is for', 'Instructions', 'Where it runs', 'When it runs', 'Voice', 'Model']) expect(within(editor).getByLabelText(label)).toBeVisible();
    expect(within(editor).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Access', 'When it runs', 'Voice and model']);
    // Nothing is folded away, and none of the words of its insides are said.
    expect(editor.querySelector('details')).toBeNull();
    expect(within(editor).queryByText(/Advanced/)).not.toBeInTheDocument();
    expect(editor.querySelector('textarea.mono')).toBeNull();
    expect(editor.textContent).not.toMatch(/\bloop|\bgates?\b|\bspec\b|\bskills?\b|JSON|bot\.json/i);
    expect(within(editor).getByRole('button', { name: 'Play the voice' })).toBeDisabled(); // no samples yet
    const name = within(editor).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Mail helper');
    await user.clear(within(editor).getByLabelText('What it is for'));
    await user.type(within(editor).getByLabelText('What it is for'), 'Answers the post.');
    await user.type(within(editor).getByLabelText('Instructions'), ' Be brief.');
    await waitFor(() => expect(within(within(editor).getByLabelText('Model')).getAllByRole('option').length).toBeGreaterThan(3));
    await user.selectOptions(within(editor).getByLabelText('Model'), 'claude-haiku-5-5');
    await user.selectOptions(within(editor).getByLabelText('Voice'), 'bf_emma');
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    expect(await screen.findByText('Mail helper is saved.')).toBeInTheDocument();
    // How it works inside goes back exactly as it came.
    expect(fake.state.bodies[0]).toEqual({
      name: 'Mail helper',
      summary: 'Answers the post.',
      instructions: 'Read new emails and answer the easy ones. Be brief.',
      look: inbox().look,
      mascot: '',
      voice: 'bf_emma',
      model: 'claude-haiku-5-5',
      permission_mode: 'ask',
      schedule: expect.objectContaining({ every: 'off' }),
      runs_on: null,
      folders: [],
      spec: inbox().spec,
      skills: inbox().skills,
    });
    expect(fake.state.bodies).toHaveLength(1); // its apps were not touched, so not saved again
    await waitFor(() => expect(router.state.location.pathname).toBe('/bots/mail-helper'));
    expect(screen.queryByRole('dialog', { name: 'Edit Inbox helper' })).not.toBeInTheDocument();
  });

  it('shuffles among the cats there are', async () => {
    const fake = on({ bots: [inbox({ mascot: drawnMascot })] });
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    await user.click(within(editor).getByRole('button', { name: 'Shuffle the cat' }));
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(fake.state.bodies[0]).toMatchObject({ mascot: '', look: { head: expect.any(String), tail: expect.any(String), pose: expect.any(String) } }));
  });

  it('gives a bot its apps under Access: a row each with a switch, how many tools, and Choose tools', async () => {
    const fake = on();
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    const apps = within(editor).getByRole('list', { name: 'Apps it can use' });
    await waitFor(() => expect(within(apps).getAllByRole('listitem')).toHaveLength(2));
    const [gmail, slack] = within(apps).getAllByRole('listitem');
    // Gmail is on, with one of its three tools; Slack is off.
    expect(within(gmail!).getByRole('switch', { name: 'Gmail' })).toBeChecked();
    await waitFor(() => expect(gmail).toHaveTextContent('Gmailchris@example.com1 of 3 toolsChoose tools'));
    expect(within(slack!).getByRole('switch', { name: 'Slack' })).not.toBeChecked();
    expect(within(slack!).queryByRole('button', { name: /Choose tools/ })).not.toBeInTheDocument();
    expect(within(editor).getByRole('link', { name: '+ Connect an app' })).toHaveAttribute('href', '/connections');
    // Slack switched on gives it Slack's tools.
    await user.click(within(slack!).getByRole('switch', { name: 'Slack' }));
    await waitFor(() => expect(slack).toHaveTextContent('1 of 1 tool'));
    // Choose tools is the tool permissions, for that app.
    await user.click(within(gmail!).getByRole('button', { name: 'Choose tools: Gmail' }));
    const tools = await screen.findByRole('dialog', { name: 'Gmail · chris@example.com tools' });
    const writes = within(tools).getByRole('region', { name: 'Write/delete tools' });
    await user.click(within(writes).getByRole('button', { name: /Write\/delete tools/ }));
    await user.click(within(writes).getByRole('switch', { name: 'Send email' }));
    await user.click(within(tools).getByRole('button', { name: 'Done' }));
    expect(gmail).toHaveTextContent('2 of 3 tools');
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    expect(await screen.findByText('Inbox helper is saved.')).toBeInTheDocument();
    expect(fake.state.bodies[1]).toEqual([
      { connection_id: 'c-gmail', tools: ['gmail-find-email', 'gmail-send-email'] },
      { connection_id: 'c-slack', tools: ['slack-send-message'] },
    ]);
  });

  it('gives a bot on a rrotor that machine’s folders, to read or to change, and none on Glyphh cloud', async () => {
    const fake = on({ bots: [inbox({ runs_on: 'rr-studio', folders: [{ path: '/Users/chris/Desktop', access: 'write' }] })] });
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    const where = within(editor).getByRole('combobox', { name: 'Where it runs' });
    await waitFor(() => expect(within(where).getAllByRole('option')).toHaveLength(3));
    expect(within(where).getByRole('option', { name: 'Acme (offline)' })).toBeDisabled();
    const folders = within(editor).getByRole('list', { name: 'Folders it can use' });
    expect(within(folders).getByRole('combobox', { name: 'Access to /Users/chris/Desktop' })).toHaveValue('write');
    // Add a folder: the machine's own folders, read from the machine, opened one by one.
    await user.click(within(editor).getByRole('button', { name: '+ Add a folder' }));
    const picker = await screen.findByRole('dialog', { name: 'Folders on Studio Mac' });
    expect(await within(picker).findByRole('button', { name: 'Add Desktop' })).toBeDisabled(); // it has it already
    await user.click(within(picker).getByRole('button', { name: 'Open Documents' }));
    await user.click(await within(picker).findByRole('button', { name: 'Add Invoices' }));
    expect(fake.state.seen).toEqual(expect.arrayContaining(['folders ', 'folders /Users/chris/Documents']));
    expect(screen.queryByRole('dialog', { name: 'Folders on Studio Mac' })).not.toBeInTheDocument();
    // A new folder is read only until said otherwise; one can be taken off.
    expect(within(folders).getByRole('combobox', { name: 'Access to /Users/chris/Documents/Invoices' })).toHaveValue('read');
    await user.selectOptions(within(folders).getByRole('combobox', { name: 'Access to /Users/chris/Documents/Invoices' }), 'Read and change');
    await user.click(within(folders).getByRole('button', { name: 'Remove /Users/chris/Desktop' }));
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(fake.state.bodies[0]).toMatchObject({ runs_on: 'rr-studio', folders: [{ path: '/Users/chris/Documents/Invoices', access: 'write' }] }));
    // On Glyphh cloud there are none to give.
    const again = renderApp('/bots/inbox-helper?edit=1');
    const cloud = (await screen.findAllByRole('dialog', { name: 'Edit Inbox helper' })).at(-1)!;
    await waitFor(() => expect(within(within(cloud).getByRole('combobox', { name: 'Where it runs' })).getAllByRole('option')).toHaveLength(3));
    await again.user.selectOptions(within(cloud).getByRole('combobox', { name: 'Where it runs' }), '');
    expect(within(cloud).getByText('Glyphh cloud has no folders. Choose a rrotor to give it files.')).toBeInTheDocument();
    expect(within(cloud).queryByRole('button', { name: '+ Add a folder' })).not.toBeInTheDocument();
    await again.user.click(within(cloud).getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(fake.state.bodies.at(-1)).toMatchObject({ runs_on: null, folders: [] }));
  });

  it('lets a folder’s path be typed when the machine cannot show its folders', async () => {
    const fake = on({ bots: [inbox({ runs_on: 'rr-acme' })] });
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    await waitFor(() => expect(within(within(editor).getByRole('combobox', { name: 'Where it runs' })).getAllByRole('option')).toHaveLength(3));
    server.use(http.get('https://rrotor.acme.test/v1/folders', () => HttpResponse.error()));
    await user.click(within(editor).getByRole('button', { name: '+ Add a folder' }));
    const picker = await screen.findByRole('dialog', { name: 'Folders on Acme' });
    expect(await within(picker).findByText(/That machine did not answer/)).toBeInTheDocument();
    await user.type(within(picker).getByLabelText('Type the folder’s path instead'), '/srv/invoices{Enter}');
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(fake.state.bodies[0]).toMatchObject({ folders: [{ path: '/srv/invoices', access: 'read' }] }));
  });

  it('says when it must ask as a choice of three, and when it runs in plain words', async () => {
    const fake = on();
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    const asks = within(editor).getByRole('radiogroup', { name: 'Before it acts' });
    expect(within(asks).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Ask me firstIt waits for your yes before every action.',
      'Follow each app’s settingsIt asks only where an app is set to ask.',
      'Act on its ownIt does not ask. What you blocked still never happens.',
    ]);
    expect(within(asks).getByRole('radio', { name: /Ask me first/ })).toBeChecked();
    await user.click(within(asks).getByRole('radio', { name: /Follow each app’s settings/ }));
    expect(within(asks).getByRole('radio', { name: /Follow each app’s settings/ })).toBeChecked();
    // The schedule, in plain words.
    const runs = within(editor).getByRole('combobox', { name: 'When it runs' });
    expect(runs).toHaveValue('off');
    expect(within(editor).getByText('It runs only when you run it.')).toBeInTheDocument();
    expect(within(editor).queryByLabelText('What it looks at each time')).not.toBeInTheDocument();
    await user.selectOptions(runs, 'weekdays');
    await user.selectOptions(within(editor).getByRole('combobox', { name: 'Time zone' }), 'America/Chicago');
    const time = within(editor).getByLabelText('At');
    fireEvent.change(time, { target: { value: '' } }); // a cleared picker keeps its time
    fireEvent.change(time, { target: { value: '07:30' } });
    await user.type(within(editor).getByLabelText('What it looks at each time'), 'is:unread');
    expect(within(editor).getByText('Runs on weekdays at 7:30 (America/Chicago time).')).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    expect(await screen.findByText('Inbox helper is saved.')).toBeInTheDocument();
    expect(fake.state.bodies[0]).toMatchObject({
      permission_mode: 'connection',
      runs_on: null,
      schedule: { every: 'weekdays', at: '07:30', timezone: 'America/Chicago', input: 'is:unread' },
      spec: inbox().spec,
      skills: { tone: 'Write short, warm replies.' },
    });
  });

  it('changes an existing bot from plain words: Claude is sent the bot as it stands, and what it decides comes back with it', async () => {
    const changed = drafted({ name: 'Inbox helper', summary: 'Answers the easy emails.', instructions: 'Read new emails, answer the easy ones and flag the angry ones.', look: inbox().look, spec: { ...inbox().spec, gates: { easy: { options: ['answer', 'leave'] }, mood: { outcomes: ['angry', 'calm'] } } }, skills: { tone: 'Write short, warm replies.', mood: 'Angry means capitals.' }, apps: [{ app: 'gmail', tools: ['gmail-find-email'] }] });
    const fake = on({ maker: [{ reply: 'It now flags the angry ones too.', draft: changed, problems: [], missing_apps: [] }] });
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    expect(within(editor).queryByLabelText('Describe your bot and Claude makes it')).not.toBeInTheDocument();
    await waitFor(() => expect(within(within(editor).getByLabelText('Model')).getAllByRole('option').length).toBeGreaterThan(3));
    await waitFor(() => expect(within(within(editor).getByRole('list', { name: 'Apps it can use' })).getAllByRole('listitem')).toHaveLength(2));
    await user.type(within(editor).getByLabelText('Tell Claude what to change'), 'also flag the angry ones');
    await user.click(within(editor).getByRole('button', { name: 'Change it' }));
    expect(await within(editor).findByText('It now flags the angry ones too.')).toBeInTheDocument();
    expect(fake.state.bodies[0]).toEqual({
      messages: [{ role: 'user', content: 'also flag the angry ones' }],
      draft: {
        name: 'Inbox helper',
        summary: 'Answers the easy emails.',
        look: inbox().look,
        mascot: '',
        instructions: 'Read new emails and answer the easy ones.',
        model: 'claude-sonnet-5-5',
        spec: inbox().spec,
        skills: inbox().skills,
        apps: [{ app: 'gmail', tools: ['gmail-find-email'] }],
        connections: [{ connection_id: 'c-gmail', tools: ['gmail-find-email'] }],
      },
    });
    expect(within(editor).getByLabelText('Instructions')).toHaveValue('Read new emails, answer the easy ones and flag the angry ones.');
    expect(within(editor).getByText(/Decides: easy \(answer, leave\), mood \(angry, calm\) · learned from your answers/)).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    expect(await screen.findByText('Inbox helper is saved.')).toBeInTheDocument();
    expect(fake.state.bodies[1]).toMatchObject({ spec: changed.spec, skills: changed.skills });
  });

  it('says what a bot decides in one quiet line, with a way to what it has learned; no line when it decides nothing', async () => {
    on({ bots: [inbox(), inbox({ id: 'b-2', slug: 'quiet', name: 'Quiet', spec: { loop: [{ step: 'work' }] }, gate_models: [] })] });
    const { user, router } = renderApp('/bots/quiet?edit=1');
    const quiet = await screen.findByRole('dialog', { name: 'Edit Quiet' });
    expect(within(quiet).queryByText(/Decides:/)).not.toBeInTheDocument();
    expect(within(quiet).queryByRole('button', { name: 'See what it has learned' })).not.toBeInTheDocument();
    await user.click(within(quiet).getByRole('button', { name: 'Close' }));
    await router.navigate('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    expect(within(editor).getByText(/Decides: easy \(answer, leave\) · learned from your answers/)).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'See what it has learned' }));
    expect(await screen.findByRole('region', { name: 'Ada gates' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit Inbox helper' })).not.toBeInTheDocument();
  });

  it('says the problems the server finds on save as plain sentences under Save', async () => {
    on({ problems: ['loop[2]: no such tool gmail-send', 'gates.easy: needs options', 'The schedule needs a time'] });
    const { user } = renderApp('/bots/inbox-helper?edit=advanced');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    const problems = await within(editor).findByRole('list', { name: 'Problems' });
    expect(within(problems).getAllByRole('listitem').map((p) => p.textContent)).toEqual(['No such tool gmail-send.', 'Needs options.', 'The schedule needs a time.']);
    expect(within(editor).getByRole('alert')).toHaveTextContent('It was not saved.');
    expect(within(editor).getByRole('button', { name: 'Save bot' }).compareDocumentPosition(problems) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('makes a new bot from a description: Claude asks, then drafts it into the fields, and Save makes it', async () => {
    const fake = on();
    const { user, router } = renderApp('/bots');
    await user.click(await screen.findByRole('button', { name: '+ New bot' }));
    const editor = await screen.findByRole('dialog', { name: 'New bot' });
    expect(within(editor).getByRole('button', { name: 'Save bot' })).toBeDisabled();
    expect(within(editor).queryByRole('button', { name: 'Delete bot' })).not.toBeInTheDocument();
    const idea = within(editor).getByLabelText('Describe your bot and Claude makes it');
    await user.type(idea, 'post urgent support email to Slack{Enter}');
    expect(await within(editor).findByText('Which Slack channel should the urgent ones go to?')).toBeInTheDocument();
    await user.type(idea, '#support');
    await user.click(within(editor).getByRole('button', { name: 'Make it' }));
    await waitFor(() => expect(within(editor).getByLabelText('Name')).toHaveValue('Support triage'));
    expect(within(editor).getByLabelText('What it is for')).toHaveValue('Posts the urgent support email to Slack.');
    expect(fake.state.seen).toEqual(expect.arrayContaining(['draft 1', 'draft 3']));
    expect(fake.state.bodies[0]).toMatchObject({ draft: null }); // a new bot starts from nothing
    // What Claude drafted it to decide is said, with nothing learned to see yet.
    expect(within(editor).getByText(/Decides: urgency · learned from your answers/)).toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'See what it has learned' })).not.toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/bots/support-triage'));
    expect(fake.state.bodies.at(-1)).toMatchObject({
      name: 'Support triage',
      look: { head: 'spiky' },
      spec: { touches: 'sends' },
      skills: { 'urgent-post': 'One block per ticket.' },
      connections: [
        { connection_id: 'c-gmail', tools: ['gmail-find-email'] },
        { connection_id: 'c-slack', tools: ['slack-send-message'] },
      ],
    });
    expect(await screen.findByText('Support triage is made.')).toBeInTheDocument();
  });

  it('draws a new mascot from words in its own modal, beside Shuffle, and saves it', async () => {
    const fake = on();
    const { user } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    await user.click(within(editor).getByRole('button', { name: 'Describe a new one' }));
    const modal = await screen.findByRole('dialog', { name: 'Describe a new mascot' });
    await user.type(within(modal).getByLabelText('Describe it'), 'a sleepy cat in a chef’s hat');
    await user.click(within(modal).getByRole('button', { name: 'Draw it' }));
    await user.click(await within(modal).findByRole('button', { name: 'Use it' }));
    expect(fake.state.seen).toContain('mascot a sleepy cat in a chef’s hat');
    await user.click(within(editor).getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(fake.state.bodies.at(-1)).toMatchObject({ mascot: drawnMascot }));
  });

  it('deletes a bot once asked', async () => {
    const fake = on();
    const { user, router } = renderApp('/bots/inbox-helper?edit=1');
    const editor = await screen.findByRole('dialog', { name: 'Edit Inbox helper' });
    await user.click(within(editor).getByRole('button', { name: 'Delete bot' }));
    const sure = await screen.findByRole('dialog', { name: 'Delete Inbox helper?' });
    await user.click(within(sure).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(fake.state.seen).toContain('delete inbox-helper'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/bots'));
    expect(await screen.findByText('Inbox helper is deleted.')).toBeInTheDocument();
  });
});

describe('a bot’s words as markdown', () => {
  it('renders tables, checklists and code with Copy, and lets a link go only to the web', () => {
    const html = md('| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n```js\nlet a = 1\n```\n\n[ok](https://glyphh.ai) [bad](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).toContain('<div class="mdtable"><table>');
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked/> done');
    expect(html).toContain('<button type="button" data-act="copy">Copy</button>');
    expect(html).toContain('<a href="https://glyphh.ai" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(safeHref('mailto:support@glyphh.ai')).toBe(true);
    expect(safeHref('data:text/html,x')).toBe(false);
  });
});
