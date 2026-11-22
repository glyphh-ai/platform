import { http, HttpResponse } from 'msw';
import type { BotRun } from '@/api/bots';
import type { GitHubKey, NewProject, Project, ProjectRun, Turn } from '@/api/projects';
import { apiError } from './server';

/**
 * Projects as the server answers them (/v1/projects, /v1/project-runs, /v1/github-key, and their pull requests in
 * /v1/bot-approvals beside the bots' runs), held in state. A run starts with its first turn out (working, or being
 * picked by the orchestrator); the next read of it finds the turn's pull request open, waiting for the person (review
 * each_turn); merged or rejected, the next bot's turn opens one; after the last the run is done. With review `end` a
 * run that waits with no open turn waits on its own pull request of it all.
 */
const v1 = (path: string) => `*/api/v1${path}`;
const at = '2026-11-21T10:00:00Z';
const REPO = 'https://github.com/acme/site';

export const crew = [
  { id: 'b-inbox', slug: 'inbox-helper', name: 'Inbox helper' },
  { id: 'b-digest', slug: 'digest', name: 'Digest' },
];

export const siteCrew = (given: Partial<Project> = {}): Project => ({
  id: 'p-site',
  slug: 'site-crew',
  name: 'Site crew',
  repo_url: REPO,
  base_branch: 'main',
  members: crew,
  instructions: 'Keep the site small and fast.',
  instructions_path: 'PROJECT.md',
  turn_mode: 'wait',
  orchestrator: null,
  review: 'each_turn',
  runs_on: 'rr-studio',
  max_turns: 30,
  max_spend_cents: null,
  narrate: false,
  created_at: at,
  updated_at: at,
  ...given,
});

export const turn = (n: number, given: Partial<Turn> = {}): Turn => {
  const bot = crew[(n - 1) % crew.length]!;
  return {
    n,
    bot_id: bot.id,
    bot_slug: bot.slug,
    bot_name: bot.name,
    branch: `turn-${n}-${bot.slug}-k3x9`,
    status: 'open',
    picked_by: 'wait',
    why: '',
    said: n === 1 ? 'I made the home page with a hero and the three plans. Next: tests for the plan cards.' : 'Added tests for the plan cards; they pass.',
    title: n === 1 ? `${bot.name}: I made the home page with a hero and the three plans.` : `${bot.name}: Added tests for the plan cards`,
    pr_url: `${REPO}/pull/${40 + n}`,
    number: 40 + n,
    head_sha: 'a1b2c3d',
    files:
      n === 1
        ? [
            { path: 'src/pages/Home.tsx', added: 84, removed: 3 },
            { path: 'src/styles/home.css', added: 41, removed: 0 },
          ]
        : [{ path: 'src/pages/Home.test.tsx', added: 36, removed: 0 }],
    done: n > 1,
    error: '',
    input_tokens: 12_400,
    output_tokens: 1_800,
    cost_micros: 64_000,
    created_at: at,
    finished_at: null,
    ...given,
  };
};

/** A turn still out: nothing said, no pull request yet. */
const out = (n: number, given: Partial<Turn> = {}): Turn =>
  turn(n, { status: 'running', said: '', title: '', pr_url: null, number: null, head_sha: null, files: [], done: false, input_tokens: 0, output_tokens: 0, cost_micros: 0, ...given });

/** The orchestrator choosing who goes next: no bot yet. */
export const picking = (n: number): Turn => out(n, { status: 'picking', bot_id: null, bot_slug: '', bot_name: '', branch: '', picked_by: 'orchestrator' });

/** The orchestrator's own closing turn (cloud runs): it says the project is done, and why. */
export const closing = (n: number, said: string): Turn =>
  out(n, { status: 'unchanged', bot_id: null, bot_slug: '', bot_name: 'Orchestrator', branch: '', picked_by: 'orchestrator', said, done: true, finished_at: at });

export const projectRun = (given: Partial<ProjectRun> = {}): ProjectRun => ({
  id: 'pr-1',
  project_slug: 'site-crew',
  task: 'Make the home page: a hero and the three plans.',
  status: 'needs_input',
  ended: '',
  turn_mode: 'wait',
  review: 'each_turn',
  runs_on: 'rr-studio',
  max_turns: 30,
  max_spend_cents: null,
  work_branch: null,
  pr_url: null,
  number: null,
  error: '',
  turns: [turn(1)],
  input_tokens: 12_400,
  output_tokens: 1_800,
  cost_micros: 64_000,
  created_at: at,
  finished_at: null,
  ...given,
});

/** A project run's waiting pull request (a turn's, or with review `end` the run's own) as the approvals queue lists it. */
export const asked = (run: ProjectRun): BotRun | null => {
  if (run.status !== 'needs_input') return null;
  const t = run.turns.find((x) => x.status === 'open');
  if (!t && !run.pr_url) return null;
  const data = t
    ? { pr_url: t.pr_url, number: t.number, title: t.title, said: t.said, files: t.files, branch: t.branch, n: t.n }
    : { pr_url: run.pr_url, number: run.number, title: 'The whole run', said: '', files: [], branch: run.work_branch, n: run.turns.length };
  return {
    id: run.id,
    bot_slug: t?.bot_slug ?? '',
    status: 'needs_input',
    input: run.task,
    output: '',
    error: '',
    log: [],
    data,
    question: { question: t ? `Merge PR #${t.number} by ${t.bot_name}?` : `Merge PR #${run.number}, the whole run?`, options: ['merge', 'reject'], batch: null, answer_with: null },
    input_tokens: 0,
    output_tokens: 0,
    cost_micros: 0,
    own_key: true,
    runs_on: run.runs_on,
    kind: 'project',
    project_slug: run.project_slug,
    created_at: t?.created_at ?? run.created_at,
    started_at: run.created_at,
    finished_at: null,
  };
};

type Options = {
  projects?: Project[];
  runs?: ProjectRun[];
  key?: GitHubKey;
  /** The server's own Claude key, which a cloud project runs on; off, a cloud run is refused (503 anthropic_off). */
  anthropic?: boolean;
  /** The org's rrotors that are offline: a run on one is refused (409 rrotor_offline). */
  offline?: string[];
  botRuns?: () => BotRun[];
};

export function projectsFake({
  projects = [siteCrew()],
  runs = [],
  key = { set: true, hint: 'x9Qz', login: 'acme-bot', set_at: at },
  anthropic = true,
  offline = ['rr-acme'],
  botRuns = () => [],
}: Options = {}) {
  const state = { projects: structuredClone(projects), runs: structuredClone(runs), key: { ...key }, seen: [] as string[], bodies: [] as unknown[], reads: new Map<string, number>() };
  let next = 1;
  const find = (slug: unknown) => state.projects.find((p) => p.slug === slug);
  const run = (id: unknown) => state.runs.find((r) => r.id === id);
  const missing = () => apiError(404, 'E_NOT_FOUND', 'There is no such project.');
  const noRun = () => apiError(404, 'E_NOT_FOUND', 'There is no such project run.');
  const members = (ids: string[]) => ids.map((id) => crew.find((c) => c.id === id) ?? { id, slug: id, name: id });
  const live = (p: Project) => state.runs.some((r) => r.project_slug === p.slug && (r.status === 'running' || r.status === 'needs_input'));

  const handlers = [
    http.get(v1('/projects'), () => HttpResponse.json({ projects: state.projects })),
    http.post(v1('/projects'), async ({ request }) => {
      const body = (await request.json()) as NewProject;
      state.bodies.push(body);
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (find(slug)) return apiError(409, 'E_CONFLICT', `The org already has a project '${slug}': name it another way.`);
      const made = siteCrew({ ...body, runs_on: body.runs_on ?? null, id: `p-${next++}`, slug, members: members(body.members) });
      state.projects.push(made);
      state.seen.push(`create ${slug}`);
      return HttpResponse.json(made, { status: 201 });
    }),
    http.get(v1('/projects/:slug'), ({ params }) => (find(params.slug) ? HttpResponse.json(find(params.slug)) : missing())),
    http.patch(v1('/projects/:slug'), async ({ params, request }) => {
      const p = find(params.slug);
      if (!p) return missing();
      const change = (await request.json()) as Partial<NewProject>;
      state.bodies.push(change);
      Object.assign(p, change, change.members ? { members: members(change.members) } : {}, { updated_at: new Date(Date.parse(at) + next++ * 1000).toISOString() });
      state.seen.push(`update ${params.slug}`);
      return HttpResponse.json(p);
    }),
    http.delete(v1('/projects/:slug'), ({ params }) => {
      state.projects = state.projects.filter((p) => p.slug !== params.slug);
      state.seen.push(`delete ${params.slug}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(v1('/projects/:slug/runs'), ({ params }) => HttpResponse.json({ runs: state.runs.filter((r) => r.project_slug === params.slug) })),
    http.post(v1('/projects/:slug/runs'), async ({ params, request }) => {
      const p = find(params.slug);
      if (!p) return missing();
      if (!state.key.set) return apiError(404, 'E_NOT_FOUND', 'Save the org’s GitHub token first.', { reason: 'github_key' });
      if (live(p)) return apiError(409, 'E_CONFLICT', 'The project has a run going: answer its pull request, or cancel it, first.');
      if (p.runs_on && offline.includes(p.runs_on)) return apiError(409, 'E_CONFLICT', 'Its rrotor is offline: start it, or choose another place.', { reason: 'rrotor_offline' });
      if (!p.runs_on && !anthropic) return apiError(503, 'E_UNAVAILABLE', 'Glyphh cloud cannot run projects right now.', { reason: 'anthropic_off' });
      const { task } = (await request.json()) as { task: string };
      state.bodies.push({ task });
      const made = projectRun({
        id: `pr-${next++}`,
        project_slug: p.slug,
        task,
        status: 'running',
        turn_mode: p.turn_mode,
        review: p.review,
        runs_on: p.runs_on,
        max_turns: p.max_turns,
        max_spend_cents: p.max_spend_cents,
        turns: [p.turn_mode === 'orchestrator' ? picking(1) : out(1)],
        input_tokens: 0,
        output_tokens: 0,
        cost_micros: 0,
      });
      state.runs.unshift(made);
      state.seen.push(`run ${p.slug}`);
      return HttpResponse.json(made, { status: 202 });
    }),
    http.get(v1('/project-runs/:id'), ({ params }) => {
      const r = run(params.id);
      if (!r) return noRun();
      const reads = (state.reads.get(r.id) ?? 0) + 1;
      state.reads.set(r.id, reads);
      const last = r.turns.at(-1);
      if (reads >= 2 && r.status === 'running' && (last?.status === 'running' || last?.status === 'picking')) {
        Object.assign(last, turn(last.n, last.status === 'picking' ? { picked_by: 'orchestrator', why: 'The home page comes first.' } : {}));
        r.status = 'needs_input';
      }
      return HttpResponse.json(r);
    }),
    http.post(v1('/project-runs/:id/answer'), async ({ params, request }) => {
      const r = run(params.id);
      if (!r) return noRun();
      const open = r.turns.find((t) => t.status === 'open');
      const whole = !open && r.review === 'end' && r.pr_url !== null;
      if (r.status !== 'needs_input' || (!open && !whole)) return apiError(409, 'E_CONFLICT', 'That project run is not waiting on a pull request.');
      const { answer } = (await request.json()) as { answer: 'merge' | 'reject' };
      state.bodies.push(answer);
      if (open) {
        open.status = answer === 'merge' ? 'merged' : 'rejected';
        open.finished_at = at;
      }
      if (open && r.turns.length < crew.length) {
        r.turns.push(turn(r.turns.length + 1));
      } else {
        Object.assign(r, { status: 'done', ended: 'done', finished_at: at });
      }
      state.seen.push(`${answer} ${r.id}`);
      return HttpResponse.json(r, { status: 202 });
    }),
    http.post(v1('/project-runs/:id/cancel'), ({ params }) => {
      const r = run(params.id);
      if (!r) return noRun();
      for (const t of r.turns) if (t.status === 'running' || t.status === 'picking') t.status = 'cancelled';
      Object.assign(r, { status: 'failed', error: 'cancelled', finished_at: at });
      state.seen.push(`cancel ${r.id}`);
      return HttpResponse.json(r);
    }),
    http.get(v1('/bot-approvals'), () =>
      HttpResponse.json({ runs: [...botRuns().filter((r) => r.status === 'needs_input'), ...state.runs.map(asked).filter((r): r is BotRun => r !== null)] }),
    ),
    http.get(v1('/github-key'), () => HttpResponse.json(state.key)),
    http.put(v1('/github-key'), async ({ request }) => {
      const { token } = (await request.json()) as { token: string };
      if (token.endsWith('bad')) return apiError(422, 'E_INVALID', 'GitHub does not take that token.', { reason: 'token' });
      state.key = { set: true, hint: token.slice(-4), login: 'acme-bot', set_at: at };
      state.seen.push('github key');
      return HttpResponse.json(state.key);
    }),
    http.delete(v1('/github-key'), () => {
      state.key = { set: false, hint: '', login: '', set_at: null };
      state.seen.push('github key removed');
      return HttpResponse.json(state.key);
    }),
  ];
  return { state, handlers };
}
