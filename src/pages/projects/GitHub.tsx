import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connected, connectUrl, githubKeys, useGitHubInstallations, useGitHubInstallLink, useGitHubRepos, type GitHubRepo } from '@/api/github';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { cx } from '@/lib/cx';
import { repoName } from './parts';
import styles from './projects.module.css';

/** GitHub's mark, drawn: one path, the colour of the words beside it. */
export function GitHubMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

/**
 * Opens GitHub's install page for the Glyphh App in a new tab. The tab is opened at the click (a browser blocks one
 * opened later) and sent on once the server answers the link; a refusal closes it and is said in place.
 */
export function useConnectGitHub() {
  const link = useGitHubInstallLink();
  const open = () => {
    const tab = window.open('', '_blank');
    link.mutate(undefined, {
      onSuccess: (url) => {
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else window.location.assign(url);
      },
      onError: () => tab?.close(),
    });
  };
  return { open, pending: link.isPending, error: link.error };
}

/** Back from GitHub's tab: who is connected, and to which repos, is read again. */
function useRefreshOnReturn() {
  const client = useQueryClient();
  useEffect(() => {
    const again = () => {
      if (!document.hidden) void client.invalidateQueries({ queryKey: githubKeys.all });
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [client]);
}

/** Connect GitHub, as the modal's one white button with GitHub's mark. */
export function ConnectButton({ onClick, busy, label = 'Connect GitHub' }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button type="button" className={cx(styles.btn, styles.btnPrimary, styles.ghConnect)} aria-busy={busy || undefined} disabled={busy} onClick={onClick}>
      <GitHubMark /> {label}
    </button>
  );
}

type PickerProps = { repos: GitHubRepo[]; value: string; onPick: (repo: GitHubRepo) => void };

/** The installation's repos as a small list that opens under its button, with a box to narrow it. */
function RepoPicker({ repos, value, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);
  const shown = repos.filter((r) => r.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className={styles.ghPicker} ref={root}>
      <button
        type="button"
        className={cx(styles.ghPick, open && styles.ghPickOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={value ? `GitHub repo: ${repoName(value)}` : 'GitHub repo: choose one'}
        onClick={() => setOpen(!open)}
      >
        <span className={value ? styles.ghPicked : styles.ghNone}>{value ? repoName(value) : 'Choose a repo'}</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.ghList}>
          {repos.length > 6 && (
            <input
              autoFocus
              className={styles.monoInput}
              aria-label="Find a repo"
              placeholder="Find a repo"
              value={q}
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          )}
          <div role="listbox" id={id} aria-label="Repos" className={styles.ghOptions}>
            {shown.map((r) => (
              <button
                key={r.full_name}
                type="button"
                role="option"
                aria-selected={r.url === value}
                className={styles.ghOption}
                onClick={() => {
                  setOpen(false);
                  setQ('');
                  onPick(r);
                }}
              >
                <span className={styles.menuDot} aria-hidden="true" />
                <span className={styles.ghRepo}>{r.full_name}</span>
                <span className={styles.ghTag}>{r.private ? 'private' : 'public'}</span>
                <span className={styles.ghBranch}>{r.default_branch}</span>
              </button>
            ))}
            {shown.length === 0 && <p className={styles.ghEmpty}>{repos.length === 0 ? 'The App is on no repo yet: add one on GitHub.' : 'No repo by that name.'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

type FieldProps = {
  /** The chosen repo's address (https://github.com/owner/name), or none yet. */
  value: string;
  onPick: (repo: GitHubRepo) => void;
  /** The account the project is connected through now, when it is one being changed. */
  account?: string | null;
};

/**
 * A project's repo, through the Glyphh GitHub App: not connected, one button that opens GitHub's install page (and
 * the answer is read again when the person comes back); connected, the account, a link to change its repos on
 * GitHub, and the repos to pick from. No address and no token is typed.
 */
export function GitHubRepoField({ value, onPick, account }: FieldProps) {
  const installations = useGitHubInstallations();
  const mine = connected(installations.data);
  const repos = useGitHubRepos(mine !== undefined);
  const connect = useConnectGitHub();
  useRefreshOnReturn();
  const listed = repos.data?.repos ?? [];
  // The project's own repo stays choosable when the person's installation does not list it (another member's).
  const options = value && !listed.some((r) => r.url === value) ? [{ full_name: repoName(value), url: value, private: true, default_branch: 'main' }, ...listed] : listed;
  const stale = connectUrl(repos.error);
  return (
    <div className={styles.group}>
      <span className={styles.label}>GitHub repo</span>
      {installations.isPending ? (
        <div className={styles.ghGhost} aria-busy="true" aria-label="Loading GitHub" />
      ) : mine ? (
        <>
          <p className={styles.ghLine}>
            <GitHubMark />
            <span>
              Connected as <b>{repos.data?.account_login ?? mine.account_login}</b>
            </span>
            <a href={repos.data?.manage_url ?? mine.manage_url} target="_blank" rel="noreferrer">
              Change repositories on GitHub
            </a>
          </p>
          {repos.isPending ? <div className={styles.ghGhost} aria-busy="true" aria-label="Loading repos" /> : !repos.error && <RepoPicker repos={options} value={value} onPick={onPick} />}
          {account && account !== mine.account_login && <small>This project works through {account}’s connection now. Saving a new repo connects it through yours.</small>}
          <ApiErrorNotice
            error={repos.error}
            action={
              stale ? (
                <a href={stale} target="_blank" rel="noreferrer">
                  Connect GitHub
                </a>
              ) : undefined
            }
          />
        </>
      ) : (
        <>
          {value && <p className={styles.ghLine}>{repoName(value)}</p>}
          <div className={styles.ghOff}>
            <ConnectButton onClick={connect.open} busy={connect.pending} />
            <small>Install Glyphh’s GitHub App on your account and choose the repos it may work in. The crew commits and opens pull requests through it: no token to paste.</small>
          </div>
          <ApiErrorNotice error={installations.error ?? connect.error} />
        </>
      )}
    </div>
  );
}
