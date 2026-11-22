import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './client';

/**
 * The Glyphh GitHub App on the person's own GitHub account (the server's /v1/github): a project's turns commit and
 * open pull requests through it, with a token the server mints for that turn and that repo alone. Installing it goes
 * through the browser: `POST /github/install` answers a link to open, GitHub asks which repos, and the server records
 * the installation. No GitHub token is ever typed or kept here.
 */
export type GitHubInstallation = {
  installation_id: number;
  account_login: string;
  created_at: string;
  /** Set once the App was removed from the account: not connected any more. */
  removed_at: string | null;
  /** The installation's page on GitHub, where its repos are chosen. */
  manage_url: string;
};
export type GitHubRepo = { full_name: string; url: string; private: boolean; default_branch: string };
export type GitHubRepos = { account_login: string; manage_url: string; repos: GitHubRepo[] };

export const githubKeys = {
  all: ['github'] as const,
  installations: ['github', 'installations'] as const,
  repos: ['github', 'repos'] as const,
};

/** The person's installation that is live, if any: at most one. */
export const connected = (list: GitHubInstallation[] | undefined) => list?.find((i) => i.removed_at === null);

export const useGitHubInstallations = () => useQuery({ queryKey: githubKeys.installations, queryFn: () => api.get<GitHubInstallation[]>('/github/installations') });
/** The repos the installation covers, asked for only once the person is connected. */
export const useGitHubRepos = (enabled: boolean) => useQuery({ queryKey: githubKeys.repos, enabled, queryFn: () => api.get<GitHubRepos>('/github/repos') });
/** A link to GitHub's install page for the App, good for ten minutes. */
export const useGitHubInstallLink = () => useMutation({ mutationFn: async () => (await api.post<{ url: string }>('/github/install')).url });

/**
 * A refusal that Connect GitHub answers: the person has no installation (`github_app_missing`), or theirs does not
 * cover the repo (`github_repo`). The link the server sent with it, to open.
 */
export function connectUrl(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const { reason, connect_url: url } = error.detail;
  return (reason === 'github_app_missing' || reason === 'github_repo') && typeof url === 'string' ? url : undefined;
}
