import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { botKeys } from './bots';
import { api } from './client';

/**
 * The org's projects (the server's /v1/projects and /v1/project-runs): a crew of its bots working on one GitHub repo
 * (through the Glyphh GitHub App: api/github.ts), from the repo's instructions file and the project's own brief. The crew is a set: who goes next is
 * the next free bot with something to do (`wait`), or whoever the orchestrator names (`orchestrator`). A run goes on
 * until the crew or the orchestrator says it is done; `max_turns` and `max_spend_cents` are its safety caps. Each turn
 * is a pull request: with review `each_turn` it waits for a merge or a reject, with `end` the turns merge into the
 * run's own branch and one pull request of it all waits at the end. It runs on Glyphh cloud (`runs_on` null) or on
 * one of the org's rrotors.
 */
export type Review = 'each_turn' | 'end';
export type TurnMode = 'wait' | 'orchestrator';
export type ProjectMember = { id: string; slug: string; name: string };
export type Project = {
  id: string;
  slug: string;
  name: string;
  repo_url: string;
  /** The GitHub account whose installation of the Glyphh App the project works through; none: not connected yet. */
  github_login: string | null;
  base_branch: string;
  /** A set: it has no order. */
  members: ProjectMember[];
  instructions: string;
  /** The file in the repo the crew reads too; `PROJECT.md` unless set. */
  instructions_path: string;
  turn_mode: TurnMode;
  /** The crew bot that picks who goes next; none is Claude. */
  orchestrator: string | null;
  review: Review;
  /** The org's rrotor it runs on; none is Glyphh cloud. */
  runs_on: string | null;
  max_turns: number;
  max_spend_cents: number | null;
  /** Read each turn aloud while its page is open. */
  narrate: boolean;
  created_at: string;
  updated_at: string;
};
export type NewProject = {
  name: string;
  repo_url: string;
  base_branch?: string;
  /** The org's bot ids, in no order. */
  members: string[];
  instructions?: string;
  instructions_path?: string;
  turn_mode?: TurnMode;
  orchestrator?: string | null;
  review?: Review;
  runs_on?: string | null;
  max_turns?: number;
  max_spend_cents?: number | null;
  narrate?: boolean;
};
export type ProjectChange = Partial<NewProject>;
/**
 * picking (the orchestrator is choosing who goes next), running, open (its pull request waits), unchanged (no
 * changes), merging, merged, conflict, rejecting, rejected, failed or cancelled.
 */
export type TurnStatus = 'picking' | 'running' | 'open' | 'unchanged' | 'merging' | 'merged' | 'conflict' | 'rejecting' | 'rejected' | 'failed' | 'cancelled';
export type ChangedFile = { path: string; added?: number; removed?: number };
export type Turn = {
  n: number;
  bot_id: string | null;
  /** Empty while the orchestrator is picking, and on the orchestrator's own closing turn. */
  bot_slug: string;
  bot_name: string;
  branch: string;
  status: TurnStatus;
  picked_by: TurnMode;
  /** Why the orchestrator picked this bot, when it said. */
  why: string;
  said: string;
  title: string;
  pr_url: string | null;
  number: number | null;
  head_sha: string | null;
  files: ChangedFile[];
  done: boolean;
  error: string;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  created_at: string;
  finished_at: string | null;
};
export type ProjectRunStatus = 'running' | 'needs_input' | 'done' | 'failed';
/** Why a run ended: the crew said so, the orchestrator said so, or a safety cap stopped it. */
export type Ended = '' | 'done' | 'orchestrator' | 'max_turns' | 'max_spend';
export type ProjectRun = {
  id: string;
  project_slug: string;
  /** May be empty: the crew then works from the instructions alone. */
  task: string;
  status: ProjectRunStatus;
  ended: Ended;
  turn_mode: TurnMode;
  review: Review;
  runs_on: string | null;
  max_turns: number;
  max_spend_cents: number | null;
  /** With review `end`: the run's own branch, and the one pull request of it all. */
  work_branch: string | null;
  pr_url: string | null;
  number: number | null;
  error: string;
  turns: Turn[];
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  created_at: string;
  finished_at: string | null;
};

export const projectKeys = {
  projects: ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
  runs: (slug: string) => ['projects', slug, 'runs'] as const,
  run: (id: string) => ['project-runs', id] as const,
};

const one = (slug: string) => `/projects/${encodeURIComponent(slug)}`;
const runPath = (id: string) => `/project-runs/${encodeURIComponent(id)}`;
/** A turn is out working (or being picked): the run is read again until it stops. */
export const runGoing = (status: ProjectRunStatus | undefined) => status === 'running';
/** Running or waiting on the person: the project can start no other run. */
export const runLive = (status: ProjectRunStatus | undefined) => status === 'running' || status === 'needs_input';

// Reads

export const useProjects = () => useQuery({ queryKey: projectKeys.projects, queryFn: async () => (await api.get<{ projects: Project[] }>('/projects')).projects });
export const useProject = (slug: string) => useQuery({ queryKey: projectKeys.project(slug), queryFn: () => api.get<Project>(one(slug)) });
/** A project's runs, newest first, asked for again every three seconds while one of them is running. */
export const useProjectRuns = (slug: string, every = 3000) =>
  useQuery({
    queryKey: projectKeys.runs(slug),
    queryFn: async () => (await api.get<{ runs: ProjectRun[] }>(`${one(slug)}/runs`)).runs,
    refetchInterval: (query) => (query.state.data?.some((r) => runGoing(r.status)) ? every : false),
  });
/** One run, asked for again every three seconds while a turn of it is out. */
export const useProjectRun = (id: string | null, every = 3000) =>
  useQuery({
    queryKey: projectKeys.run(id ?? ''),
    enabled: id !== null,
    queryFn: () => api.get<ProjectRun>(runPath(id!)),
    refetchInterval: (query) => (runGoing(query.state.data?.status) ? every : false),
  });

// Writes

function useWrite<A, T>(fn: (args: A) => Promise<T>, refresh: ReadonlyArray<readonly unknown[]>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(refresh.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

export const useCreateProject = () => useWrite((project: NewProject) => api.post<Project>('/projects', project), [projectKeys.projects]);
export const useUpdateProject = (slug: string) => useWrite((change: ProjectChange) => api.patch<Project>(one(slug), change), [projectKeys.projects]);
export const useDeleteProject = () => useWrite((slug: string) => api.delete<void>(one(slug)), [projectKeys.projects]);
/** Starts a run; the task may be empty. */
export const useRunProject = (slug: string) => useWrite((task: string) => api.post<ProjectRun>(`${one(slug)}/runs`, { task }), [projectKeys.runs(slug)]);

/** Merging or rejecting the pull request a run waits on, or cancelling it: the runs and the approvals queue read again. */
const afterRun = [projectKeys.projects, ['project-runs'], botKeys.approvals] as const;
export const useAnswerProjectRun = () =>
  useWrite(({ id, answer }: { id: string; answer: 'merge' | 'reject' }) => api.post<ProjectRun>(`${runPath(id)}/answer`, { answer }), afterRun);
export const useCancelProjectRun = () => useWrite((id: string) => api.post<ProjectRun>(`${runPath(id)}/cancel`), afterRun);