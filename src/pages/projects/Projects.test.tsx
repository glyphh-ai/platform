import { screen, waitFor, within } from '@testing-library/react';
import type { BotRun } from '@/api/bots';
import { botsFake, inbox, waiting } from '@/test/bots';
import { closing, picking, projectRun, projectsFake, siteCrew, turn } from '@/test/projects';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { CLOUD_NOTE } from './parts';

const bots = [inbox(), inbox({ id: 'b-digest', slug: 'digest', name: 'Digest' }), inbox({ id: 'b-third', slug: 'third', name: 'Third' })];
const REPO = 'https://github.com/acme/site';

/** The bots and projects fakes; the projects' first, so its approvals queue (theirs and the bots' runs) is the one answered. */
function on(given: Parameters<typeof projectsFake>[0] = {}, botRuns: BotRun[] = []) {
  const b = botsFake({ bots, runs: botRuns });
  const p = projectsFake({ botRuns: () => b.state.runs, ...given });
  server.use(...p.handlers, ...b.handlers);
  return p;
}

/** The browser's voice, stubbed: what was read aloud, in order. */
const speak = vi.fn();
const spoken = () => speak.mock.calls.map(([u]) => (u as { text: string }).text);
beforeEach(() => {
  speak.mockClear();
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      constructor(public text: string) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const texts = (items: HTMLElement[]) => items.map((el) => el.textContent?.replace(/\s+/g, ' ').trim());

describe('projects', () => {
  it('lists the org’s projects: repo, crew, where each runs, its turn mode and review', async () => {
    on({
      projects: [siteCrew(), siteCrew({ id: 'p-2', slug: 'docs', name: 'Docs crew', runs_on: null, turn_mode: 'orchestrator', orchestrator: 'b-digest', review: 'end' })],
    });
    const { user, router } = renderApp('/bots');
    await user.click(await within(await screen.findByRole('complementary', { name: 'Main' })).findByRole('link', { name: 'Projects' }));
    expect(router.state.location.pathname).toBe('/projects');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    const site = await screen.findByRole('link', { name: 'Site crew' });
    expect(site).toHaveAttribute('href', '/projects/site-crew');
    // Beside each card, the way into the crew's chat in Bots.
    expect(screen.getByRole('link', { name: 'Open Site crew’s crew chat' })).toHaveAttribute('href', '/bots?crew=site-crew');
    expect(site).toHaveTextContent('acme/site · main');
    expect(site).toHaveTextContent('Inbox helper, Digest');
    expect(site).toHaveTextContent('Wait your turn · You review each turn');
    expect(await within(site).findByText('On Studio Mac')).toBeInTheDocument();
    const docs = screen.getByRole('link', { name: 'Docs crew' });
    expect(docs).toHaveTextContent('Orchestrator: Digest · You review at the end');
    expect(within(docs).getByText('On Glyphh cloud')).toBeInTheDocument();
    // A set: no order, no rounds.
    expect(site).not.toHaveTextContent('→');
    expect(screen.queryByText(/\d rounds?/)).not.toBeInTheDocument();
  });

  it('says what a project is when there is none', async () => {
    on({ projects: [] });
    renderApp('/projects');
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByText(/A project is a crew of your bots on one GitHub repo/)).toBeInTheDocument();
  });

  it('makes a project in a small modal: the crew as a set, a rrotor, an orchestrator, review at the end, the caps under Advanced', async () => {
    const fake = on({ projects: [], key: { set: false, hint: '', login: '', set_at: null } });
    const { user, router } = renderApp('/projects');
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    expect(await within(dialog).findByRole('link', { name: 'set it' })).toHaveAttribute('href', '/settings/github-token');
    const make = within(dialog).getByRole('button', { name: 'Make project' });
    expect(make).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Name'), 'Site crew');
    await user.type(within(dialog).getByLabelText('GitHub repo'), REPO);
    await user.type(within(dialog).getByLabelText(/^Instructions/), 'Keep it small.');
    expect(within(dialog).getByText(/A PROJECT.md in the repo is read too/)).toBeInTheDocument();

    // The crew is a set: cats clicked in and out, in any order; no numbers, no Up or Down.
    const cats = await within(dialog).findByRole('group', { name: 'Crew' });
    await waitFor(() => expect(within(cats).getAllByRole('button')).toHaveLength(3));
    await user.click(within(cats).getByRole('button', { name: 'Third' }));
    await user.click(within(cats).getByRole('button', { name: 'Digest' }));
    await user.click(within(cats).getByRole('button', { name: 'Inbox helper' }));
    await user.click(within(cats).getByRole('button', { name: 'Third' }));
    expect(within(cats).getByRole('button', { name: 'Digest' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cats).getByRole('button', { name: 'Third' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).queryByRole('button', { name: /up|down/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/speaking order/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/rounds/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/It runs until the crew or the orchestrator says it's done/)).toBeInTheDocument();

    // Glyphh cloud first and chosen, with its note; then the org's rrotors, one offline greyed.
    const where = within(dialog).getByRole('radiogroup', { name: 'Runs on' });
    await waitFor(() => expect(texts(within(where).getAllByRole('radio'))).toEqual(['Glyphh cloud', 'Studio Mac', 'Acme (offline)']));
    expect(within(where).getByRole('radio', { name: 'Glyphh cloud' })).toBeChecked();
    expect(within(dialog).getByText(CLOUD_NOTE)).toBeInTheDocument();
    expect(CLOUD_NOTE).toBe(
      "Glyphh cloud has fewer tools than a rrotor: bots can read and change files and open pull requests, but can't run commands, tests or a browser. Choose a rrotor for those.",
    );
    expect(within(where).getByRole('radio', { name: 'Acme (offline)' })).toBeDisabled();
    await user.click(within(where).getByRole('radio', { name: 'Studio Mac' }));
    expect(within(dialog).queryByText(CLOUD_NOTE)).not.toBeInTheDocument();

    expect(within(dialog).getByText('Wait your turn: one bot at a time; the next free bot with something to do takes the turn.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Orchestrator' }));
    expect(within(dialog).getByText('Orchestrator: reads the repo and the instructions, names the next bot and says why.')).toBeInTheDocument();
    const who = within(dialog).getByRole('radiogroup', { name: 'Orchestrator' });
    expect(texts(within(who).getAllByRole('radio'))).toEqual(['Claude', 'Inbox helper', 'Digest']);
    expect(within(who).getByRole('radio', { name: 'Claude' })).toBeChecked();
    await user.click(within(who).getByRole('radio', { name: 'Digest' }));

    expect(within(dialog).getByText('Each turn: every pull request waits for your merge or reject.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'At the end' }));
    expect(within(dialog).getByText('At the end: turns merge into the run’s own branch; one pull request of it all waits for you at the end.')).toBeInTheDocument();

    expect(within(dialog).queryByLabelText('Base branch')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Advanced' }));
    expect(within(dialog).getByLabelText(/^Base branch/)).toHaveValue('main');
    expect(within(dialog).getByLabelText(/^Instructions file/)).toHaveValue('PROJECT.md');
    expect(within(dialog).getByLabelText(/^Max turns/)).toHaveValue(30);
    expect(within(dialog).getByLabelText(/^Max spend in dollars/)).toHaveValue('');
    await user.clear(within(dialog).getByLabelText(/^Base branch/));
    await user.type(within(dialog).getByLabelText(/^Base branch/), 'develop');
    await user.clear(within(dialog).getByLabelText(/^Max turns/));
    await user.type(within(dialog).getByLabelText(/^Max turns/), '12');
    await user.type(within(dialog).getByLabelText(/^Max spend in dollars/), '5');

    await user.click(make);
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/site-crew'));
    expect(fake.state.bodies[0]).toEqual({
      name: 'Site crew',
      repo_url: REPO,
      base_branch: 'develop',
      members: ['b-inbox', 'b-digest'],
      instructions: 'Keep it small.',
      instructions_path: 'PROJECT.md',
      turn_mode: 'orchestrator',
      orchestrator: 'b-digest',
      review: 'end',
      runs_on: 'rr-studio',
      max_turns: 12,
      max_spend_cents: 500,
    });
  });

  it('makes a project on Glyphh cloud with nothing but a name, a repo and a crew', async () => {
    const fake = on({ projects: [] });
    const { user, router } = renderApp('/projects/new');
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    expect(router.state.location.pathname).toBe('/projects');
    await user.type(within(dialog).getByLabelText('Name'), 'Docs');
    await user.type(within(dialog).getByLabelText('GitHub repo'), REPO);
    await user.click(await within(dialog).findByRole('button', { name: 'Digest' }));
    await user.click(within(dialog).getByRole('button', { name: 'Make project' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/docs'));
    expect(fake.state.bodies[0]).toEqual({
      name: 'Docs',
      repo_url: REPO,
      base_branch: 'main',
      members: ['b-digest'],
      instructions: '',
      instructions_path: 'PROJECT.md',
      turn_mode: 'wait',
      orchestrator: null,
      review: 'each_turn',
      runs_on: null,
      max_turns: 30,
      max_spend_cents: null,
    });
    // Opened, the cloud project says what the cloud cannot do under its Runs on pill.
    expect(await screen.findByRole('button', { name: 'Runs on: Glyphh cloud' })).toBeInTheDocument();
    expect(screen.getByText(CLOUD_NOTE)).toBeInTheDocument();
  });

  it('runs a project: the crew strip, the task, each turn a message with its pull request chip, merged or rejected, then done', async () => {
    const fake = on();
    const { user, client } = renderApp('/projects/site-crew');
    expect(await screen.findByRole('heading', { name: 'Site crew' })).toBeInTheDocument();
    // The crew strip: names only, no numbers, no arrows.
    expect(texts(within(screen.getByRole('list', { name: 'Crew' })).getAllByRole('listitem'))).toEqual(['Inbox helper', 'Digest']);
    expect(await screen.findByText('What are we making?')).toBeInTheDocument();
    expect(screen.queryByText(CLOUD_NOTE)).not.toBeInTheDocument(); // it runs on a rrotor
    await user.type(screen.getByPlaceholderText('Give the crew a task…'), 'Make the home page.');
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    const log = await screen.findByRole('log', { name: 'Run' });
    expect(within(log).getByText('Make the home page.')).toBeInTheDocument();
    const first = await within(log).findByRole('article', { name: 'Turn 1: Inbox helper' });
    expect(within(first).getByText(/Working on turn-1-inbox-helper-k3x9/)).toBeInTheDocument();
    expect(screen.getByText('A run is going. The crew is working.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Give the crew a task…')).not.toBeInTheDocument();

    // The turn comes back: its pull request is open and waits.
    await client.invalidateQueries({ queryKey: ['project-runs'] });
    const pr = await within(first).findByRole('region', { name: 'Pull request #41' });
    expect(within(first).getByText(/^I made the home page with a hero/)).toBeInTheDocument();
    expect(within(pr).getByRole('link', { name: 'Pull request #41 on GitHub' })).toHaveAttribute('href', `${REPO}/pull/41`);
    expect(within(pr).getByText('src/pages/Home.tsx')).toBeInTheDocument();
    expect(within(pr).getByText('+84')).toBeInTheDocument();
    expect(within(pr).getByText('2 files')).toBeInTheDocument();
    expect(within(pr).getByText('turn-1-inbox-helper-k3x9')).toBeInTheDocument();
    expect(within(first).getByText('14.2k tokens · $0.06')).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Turns' });
    expect(texts(within(chips).getAllByRole('listitem'))).toEqual(['1 Inbox helper #41 open']);
    expect(within(chips).getByRole('link', { name: 'Pull request #41 on GitHub' })).toHaveAttribute('href', `${REPO}/pull/41`);
    expect(await screen.findByText('A run is going. It waits for your merge or reject.')).toBeInTheDocument();

    await user.click(within(pr).getByRole('button', { name: 'Merge' }));
    const second = await within(log).findByRole('article', { name: 'Turn 2: Digest' });
    await waitFor(() => expect(texts(within(chips).getAllByRole('listitem'))).toEqual(['1 Inbox helper #41 merged', '2 Digest #42 open']));
    expect(within(first).queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();
    expect(within(second).getByText('says it’s done')).toBeInTheDocument();
    await user.click(within(second).getByRole('button', { name: 'Reject' }));
    expect(await within(log).findByText(/The crew said it's done · 2 turns/)).toBeInTheDocument();
    expect(texts(within(chips).getAllByRole('listitem'))).toEqual(['1 Inbox helper #41 merged', '2 Digest #42 rejected']);
    expect(fake.state.bodies).toEqual([{ task: 'Make the home page.' }, 'merge', 'reject']);
    // Done, the composer takes the next task.
    expect(await screen.findByPlaceholderText('Give the crew a task…')).toBeInTheDocument();
  });

  it('starts a run with no task: the crew works from the instructions alone', async () => {
    const fake = on();
    const { user } = renderApp('/projects/site-crew');
    await user.click(await screen.findByRole('button', { name: 'Start from the instructions' }));
    const log = await screen.findByRole('log', { name: 'Run' });
    expect(within(log).getByText('No task: the crew works from the instructions.')).toBeInTheDocument();
    expect(fake.state.bodies).toEqual([{ task: '' }]);
  });

  it('shows who the orchestrator chose and why, and that it is choosing the next', async () => {
    on({
      projects: [siteCrew({ turn_mode: 'orchestrator' })],
      runs: [
        projectRun({
          status: 'running',
          turn_mode: 'orchestrator',
          turns: [turn(1, { status: 'merged', picked_by: 'orchestrator', why: 'The home page comes first.' }), picking(2)],
        }),
      ],
    });
    renderApp('/projects/site-crew');
    const log = await screen.findByRole('log', { name: 'Run' });
    expect(log).toHaveTextContent('Orchestrator chose Inbox helper');
    expect(within(log).getByText('The home page comes first.')).toBeInTheDocument();
    expect(within(log).getByRole('status')).toHaveTextContent('Choosing who goes next…');
    expect(texts(within(screen.getByRole('list', { name: 'Turns' })).getAllByRole('listitem'))).toEqual(['1 Inbox helper #41 merged']);
    expect(await screen.findByRole('button', { name: 'Turn mode: Orchestrator · Claude' })).toBeInTheDocument();
  });

  it('shows the orchestrator’s closing turn, a turn with no changes, and why the run ended', async () => {
    on({
      projects: [siteCrew({ runs_on: null, turn_mode: 'orchestrator' })],
      runs: [
        projectRun({
          status: 'done',
          ended: 'orchestrator',
          runs_on: null,
          turn_mode: 'orchestrator',
          finished_at: '2026-11-21T10:20:00Z',
          turns: [
            turn(1, { status: 'merged', picked_by: 'orchestrator' }),
            turn(2, { status: 'unchanged', picked_by: 'orchestrator', said: '', pr_url: null, number: null, files: [], done: false }),
            closing(3, 'Everything in PROJECT.md is built.'),
          ],
        }),
      ],
    });
    renderApp('/projects/site-crew');
    const log = await screen.findByRole('log', { name: 'Run' });
    const passed = within(log).getByRole('article', { name: 'Turn 2: Digest' });
    expect(within(passed).getByText('passed')).toBeInTheDocument();
    expect(within(passed).getByText('No changes')).toBeInTheDocument();
    const last = within(log).getByRole('article', { name: 'Turn 3: Orchestrator' });
    expect(within(last).getByText('Everything in PROJECT.md is built.')).toBeInTheDocument();
    expect(within(log).getByText(/The orchestrator said it's done · 3 turns/)).toBeInTheDocument();
    expect(log).toHaveTextContent('on Glyphh cloud');
    expect(texts(within(screen.getByRole('list', { name: 'Turns' })).getAllByRole('listitem'))).toEqual(['1 Inbox helper #41 merged', '2 Digest no changes', '3 Orchestrator done']);
  });

  it.each([
    ['max_turns', /Stopped at the safety cap of 30 turns/],
    ['max_spend', /Stopped at the spend cap/],
    ['done', /The crew said it's done/],
  ] as const)('says why a run ended: %s', async (ended, words) => {
    on({ runs: [projectRun({ status: 'done', ended, turns: [turn(1, { status: 'merged' })] })] });
    renderApp('/projects/site-crew');
    expect(await within(await screen.findByRole('log', { name: 'Run' })).findByText(words)).toBeInTheDocument();
  });

  it('with review at the end, shows the run’s one pull request of it all and merges it', async () => {
    const fake = on({
      projects: [siteCrew({ review: 'end' })],
      runs: [
        projectRun({ review: 'end', work_branch: 'run-pr-1-k3x9', pr_url: `${REPO}/pull/50`, number: 50, turns: [turn(1, { status: 'merged' }), turn(2, { status: 'merged' })] }),
      ],
    });
    const { user } = renderApp('/projects/site-crew');
    const log = await screen.findByRole('log', { name: 'Run' });
    const whole = await within(log).findByRole('region', { name: 'Pull request #50' });
    expect(within(whole).getByText('Merge the whole run?')).toBeInTheDocument();
    expect(within(whole).getByRole('link', { name: 'Pull request #50 on GitHub' })).toHaveAttribute('href', `${REPO}/pull/50`);
    expect(within(whole).getByText('run-pr-1-k3x9')).toBeInTheDocument();
    expect(within(whole).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    // The turns themselves are merged into the run's branch: nothing on them to answer.
    expect(within(within(log).getByRole('article', { name: 'Turn 1: Inbox helper' })).queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument();
    await user.click(within(whole).getByRole('button', { name: 'Merge' }));
    expect(await within(log).findByText(/The crew said it's done/)).toBeInTheDocument();
    expect(within(log).getByRole('link', { name: 'the run’s pull request #50' })).toHaveAttribute('href', `${REPO}/pull/50`);
    expect(fake.state.bodies).toEqual(['merge']);
  });

  it('cancels a run and shows why one failed', async () => {
    const fake = on({
      runs: [
        projectRun({
          id: 'pr-old',
          status: 'failed',
          error: 'Digest’s turn 2 failed: the clone failed',
          turns: [turn(1, { status: 'merged' }), turn(2, { status: 'failed', pr_url: null, number: null, files: [], said: '', error: 'the clone failed' })],
        }),
      ],
    });
    const { user } = renderApp('/projects/site-crew?run=pr-old');
    const log = await screen.findByRole('log', { name: 'Run' });
    expect(within(log).getAllByText(/the clone failed/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Give the crew a task…'), 'Again.');
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(fake.state.seen).toEqual(['run site-crew', 'cancel pr-1']));
    expect((await screen.findAllByText('cancelled')).length).toBeGreaterThan(0);
    expect(await screen.findByPlaceholderText('Give the crew a task…')).toBeInTheDocument();
    // Both runs are in the Runs menu.
    await user.click(screen.getByRole('button', { name: 'Runs: 2' }));
    expect(within(screen.getByRole('menu', { name: 'Runs' })).getAllByRole('menuitemradio')).toHaveLength(2);
  });

  it.each([
    ['its rrotor is offline', { projects: [siteCrew({ runs_on: 'rr-acme' })] }, 'Its rrotor is offline: start it, or choose another place.'],
    ['Glyphh cloud has no Claude key', { projects: [siteCrew({ runs_on: null })], anthropic: false }, 'Glyphh cloud cannot run projects right now.'],
    ['the org has no GitHub token', { key: { set: false, hint: '', login: '', set_at: null } }, 'Save the org’s GitHub token first.'],
  ] as const)('says why a run cannot start: %s', async (why, given, words) => {
    on(given as Parameters<typeof projectsFake>[0]);
    const { user } = renderApp('/projects/site-crew');
    await user.click(await screen.findByRole('button', { name: 'Start from the instructions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    if (why.includes('GitHub')) expect(screen.getByRole('link', { name: 'Set the GitHub token' })).toHaveAttribute('href', '/settings/github-token');
  });

  it('reads new turns aloud only with Narrate when watched on', async () => {
    const fake = on({ projects: [siteCrew({ narrate: true })] });
    const { user, client } = renderApp('/projects/site-crew');
    const toggle = await screen.findByRole('button', { name: 'Narrate when watched' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Start from the instructions' }));
    const first = await screen.findByRole('article', { name: 'Turn 1: Inbox helper' });
    expect(speak).not.toHaveBeenCalled();
    await client.invalidateQueries({ queryKey: ['project-runs'] });
    await within(first).findByRole('region', { name: 'Pull request #41' });
    expect(spoken()).toEqual(['Inbox helper. I made the home page with a hero and the three plans. Next: tests for the plan cards.']);

    // Turned off, the next turn is not read.
    await user.click(screen.getByRole('button', { name: 'Narrate when watched' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Narrate when watched' })).toHaveAttribute('aria-pressed', 'false'));
    expect(fake.state.bodies).toContainEqual({ narrate: false });
    await user.click(within(first).getByRole('button', { name: 'Merge' }));
    expect(await screen.findByRole('article', { name: 'Turn 2: Digest' })).toBeInTheDocument();
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('is silent by default, and never reads back what was said before the page opened', async () => {
    on({ runs: [projectRun()] });
    const { user } = renderApp('/projects/site-crew');
    const first = await screen.findByRole('article', { name: 'Turn 1: Inbox helper' });
    expect(screen.getByRole('button', { name: 'Narrate when watched' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(first).getByRole('button', { name: 'Merge' }));
    expect(await screen.findByRole('article', { name: 'Turn 2: Digest' })).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
  });

  it('sets where it runs, the turn mode and the review from the composer’s pills', async () => {
    const fake = on();
    const { user } = renderApp('/projects/site-crew');
    await user.click(await screen.findByRole('button', { name: 'Runs on: Studio Mac' }));
    const places = within(screen.getByRole('menu', { name: 'Runs on' }));
    expect(places.getByRole('menuitemradio', { name: /Acme/ })).toBeDisabled();
    expect(places.getByRole('menuitemradio', { name: /Studio Mac/ })).toBeChecked();
    await user.click(places.getByRole('menuitemradio', { name: /Glyphh cloud/ }));
    expect(await screen.findByRole('button', { name: 'Runs on: Glyphh cloud' })).toBeInTheDocument();
    expect(screen.getByText(CLOUD_NOTE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Turn mode: Wait your turn' }));
    await user.click(within(screen.getByRole('menu', { name: 'Turn mode' })).getByRole('menuitemradio', { name: /Orchestrator: Digest/ }));
    expect(await screen.findByRole('button', { name: 'Turn mode: Orchestrator · Digest' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review: Each turn' }));
    await user.click(within(screen.getByRole('menu', { name: 'Review' })).getByRole('menuitemradio', { name: /At the end/ }));
    expect(await screen.findByRole('button', { name: 'Review: At the end' })).toBeInTheDocument();
    expect(fake.state.bodies).toEqual([{ runs_on: null }, { turn_mode: 'orchestrator', orchestrator: 'b-digest' }, { review: 'end' }]);
  });

  it('shows a project’s pull request in Approvals beside the bots’ runs, merged there', async () => {
    const fake = on({ runs: [projectRun()] }, [waiting()]);
    const { user } = renderApp('/approvals');
    expect(await screen.findByText(/Your projects’ pull requests wait here too/)).toBeInTheDocument();
    const queue = await screen.findByRole('list', { name: 'Waiting runs' });
    const items = await within(queue).findAllByRole('article');
    expect(items).toHaveLength(2);
    const project = within(queue).getByRole('article', { name: 'site-crew: Merge PR #41 by Inbox helper?' });
    expect(within(project).getByRole('link', { name: 'site-crew' })).toHaveAttribute('href', '/projects/site-crew?run=pr-1');
    expect(within(project).getByText(/Project · “Make the home page/)).toBeInTheDocument();
    expect(within(project).getByText(/^I made the home page with a hero/)).toBeInTheDocument();
    await user.click(within(project).getByRole('button', { name: 'Merge' }));
    // Merged, the next bot's pull request waits in its place.
    expect(await within(queue).findByRole('article', { name: 'site-crew: Merge PR #42 by Digest?' })).toBeInTheDocument();
    expect(within(queue).getAllByRole('article')).toHaveLength(2);
    expect(fake.state.bodies).toEqual(['merge']);
  });

  it('changes and deletes a project in its settings, a modal behind the gear', async () => {
    const fake = on();
    const { user, router } = renderApp('/projects/site-crew');
    await user.click(await screen.findByRole('button', { name: 'Project settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' });
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveValue('Site crew');
    await user.clear(name);
    await user.type(name, 'The crew');
    await user.click(await within(dialog).findByRole('button', { name: 'Digest' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fake.state.seen).toEqual(['update site-crew']));
    expect(fake.state.bodies[0]).toMatchObject({ name: 'The crew', members: ['b-inbox'], instructions: 'Keep the site small and fast.', runs_on: 'rr-studio', max_turns: 30 });
    expect(await screen.findByRole('heading', { name: 'The crew' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Project settings' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Project settings' }));
    await user.click(await screen.findByRole('button', { name: 'Delete project' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete The crew?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
    expect(fake.state.seen).toEqual(['update site-crew', 'delete site-crew']);
  });

  it('sends the old swarm addresses to their projects', async () => {
    on({ runs: [projectRun()] });
    const list = renderApp('/swarms');
    await waitFor(() => expect(list.router.state.location.pathname).toBe('/projects'));
    list.unmount();
    const one = renderApp('/swarms/site-crew?run=pr-1');
    await waitFor(() => expect(one.router.state.location.pathname).toBe('/projects/site-crew'));
    expect(one.router.state.location.search).toBe('?run=pr-1');
    one.unmount();
    const made = renderApp('/swarms/new');
    await waitFor(() => expect(made.router.state.location.pathname).toBe('/projects'));
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument();
  });
});

describe('the GitHub token', () => {
  it('is saved, tried by the server, shown by its last characters and removed', async () => {
    const fake = on({ key: { set: false, hint: '', login: '', set_at: null } });
    const { user } = renderApp('/settings/github-token');
    const field = await screen.findByLabelText('GitHub token');
    await user.type(field, 'github_pat_bad');
    await user.click(screen.getByRole('button', { name: 'Save token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub does not take that token.');
    await user.clear(field);
    await user.type(field, 'github_pat_goodAB12');
    await user.click(screen.getByRole('button', { name: 'Save token' }));
    expect(await screen.findByText('Token ending AB12 · acme-bot')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make one on GitHub' })).toHaveAttribute('href', expect.stringContaining('github.com/settings/personal-access-tokens'));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText(/Token ending/)).not.toBeInTheDocument());
    expect(fake.state.seen).toEqual(['github key', 'github key removed']);
  });
});
