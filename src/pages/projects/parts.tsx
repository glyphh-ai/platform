import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useBots, type BotRun, type Place } from '@/api/bots';
import { useAnswerProjectRun, type ChangedFile, type Project, type ProjectRun, type Review, type TurnMode } from '@/api/projects';
import { Cat } from '@/bots/cat/Cat';
import type { Look } from '@/bots/cat/look';
import { mascotSrc } from '@/bots/cat/mascots';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { ago, stamp } from '@/lib/format';
import { cx } from '@/lib/cx';
import styles from './projects.module.css';

/** A project is its crew's chat in the Bots area (the shell's own `crewPath`, said here so this folder stands alone). */
export const crewChatPath = (slug: string) => `/bots?crew=${encodeURIComponent(slug)}`;
export const projectRunPath = (slug: string, id: string) => `${crewChatPath(slug)}&run=${encodeURIComponent(id)}`;
export const repoName = (url: string) => url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

/** What Glyphh cloud cannot do, said wherever it is chosen. */
export const CLOUD_NOTE =
  "Glyphh cloud has fewer tools than a rrotor: bots can read and change files and open pull requests, but can't run commands, tests or a browser. Choose a rrotor for those.";

export const TURN_MODES: ReadonlyArray<{ value: TurnMode; label: string; hint: string }> = [
  { value: 'wait', label: 'Wait your turn', hint: 'Wait your turn: one bot at a time; the next free bot with something to do takes the turn.' },
  { value: 'orchestrator', label: 'Orchestrator', hint: 'Orchestrator: reads the repo and the instructions, names the next bot and says why.' },
];
export const REVIEWS: ReadonlyArray<{ value: Review; label: string; hint: string }> = [
  { value: 'each_turn', label: 'Each turn', hint: 'Each turn: every pull request waits for your merge or reject.' },
  { value: 'end', label: 'At the end', hint: 'At the end: turns merge into the run’s own branch; one pull request of it all waits for you at the end.' },
];
export const NO_ROUNDS = "There are no rounds. It runs until the crew or the orchestrator says it's done";

/** Why a run ended, in words; nothing while it has not. */
export const endedWords = (run: Pick<ProjectRun, 'ended' | 'max_turns'>) =>
  ({
    '': '',
    done: "The crew said it's done",
    orchestrator: "The orchestrator said it's done",
    max_turns: `Stopped at the safety cap of ${run.max_turns} turns`,
    max_spend: 'Stopped at the spend cap',
  })[run.ended];

/** Where a project runs, in words: Glyphh cloud, or the rrotor's name. */
export const placeName = (places: Place[] | undefined, id: string | null) => (id === null ? 'Glyphh cloud' : (places?.find((p) => p.id === id)?.name ?? 'your rrotor'));
/** Who picks the next bot, in words. */
export const turnWords = (p: Pick<Project, 'turn_mode' | 'orchestrator' | 'members'>) =>
  p.turn_mode === 'wait' ? 'Wait your turn' : `Orchestrator: ${p.members.find((m) => m.id === p.orchestrator)?.name ?? 'Claude'}`;
export const reviewWords = (review: Review) => (review === 'end' ? 'You review at the end' : 'You review each turn');

// ------------------------------------------------------------------ cats

export type Faces = Map<string, { look: Look | null | undefined; mascot?: string | null }>;

/** Each of the org's bots' own look or drawn mascot, by bot id: a project's members carry only their names. */
export function useFaces(): Faces {
  const bots = useBots();
  return useMemo(() => new Map((bots.data ?? []).map((b) => [b.id, { look: b.look, mascot: b.mascot }])), [bots.data]);
}

type FaceProps = { id: string | null; faces: Faces; size: number; busy?: boolean; mode?: 'head' | 'full' };

/** A bot's cat: its own drawn mascot when it has one (as an image, so nothing in it runs), else its look. */
export function Face({ id, faces, size, busy, mode }: FaceProps) {
  const face = id ? faces.get(id) : undefined;
  if (face?.mascot) return <img src={mascotSrc(face.mascot)} width={size} height={size} alt="" />;
  return <Cat look={face?.look} size={size} busy={busy} mode={mode} />;
}

// ------------------------------------------------------------------ a small modal

type ModalProps = { open: boolean; onClose: () => void; title: string; children: ReactNode };

/** A small modal in the Glyphh Bot app's look, on the native <dialog>: focus, Escape and the backdrop as the browser does. */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className={styles.modalBody}>
          <div className={styles.modalHead}>
            <h2 id={titleId}>{title}</h2>
            <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// ------------------------------------------------------------------ pull requests

const sum = (files: ChangedFile[], key: 'added' | 'removed') => files.reduce((n, f) => n + (f[key] ?? 0), 0);

/** What a pull request changed, a line a file: its path, lines added and taken out. */
export function Files({ files }: { files: ChangedFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className={styles.files} aria-label="Files changed">
      {files.map((f) => (
        <li key={f.path}>
          <span className={styles.path}>{f.path}</span>
          <span className={styles.add}>+{f.added ?? 0}</span>
          <span className={styles.del}>−{f.removed ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

export type PullRequest = { pr_url: string | null; number: number | null; title: string; branch: string; files: ChangedFile[] };
type PrCardProps = {
  pr: PullRequest;
  runId: string;
  /** The run waits on this pull request: Merge and Reject show on it. */
  waiting: boolean;
  /** How it stands, when it does not wait: merged, rejected, conflict… */
  badge?: string;
  ask?: string;
};

/**
 * A pull request as the Glyphh Bot app's card: its number (a link to it on GitHub), its title, how much it changed and
 * how it stands; while the run waits on it, Merge and Reject are on it. Its files are listed under it.
 */
export function PrCard({ pr, runId, waiting, badge, ask }: PrCardProps) {
  const answer = useAnswerProjectRun();
  const busy = answer.isPending;
  const label = `Pull request${pr.number === null ? '' : ` #${pr.number}`}`;
  const num = pr.number === null ? 'PR' : `PR #${pr.number}`;
  return (
    <section className={cx(styles.prcard, waiting && styles.prOpen)} aria-label={label}>
      <div className={styles.prrow}>
        {pr.pr_url ? (
          <a href={pr.pr_url} target="_blank" rel="noreferrer" className={styles.prnum} aria-label={`${label} on GitHub`}>
            {num}
          </a>
        ) : (
          <span className={styles.prnum}>{num}</span>
        )}
        <span className={styles.prtitle}>{ask ?? pr.title}</span>
        {pr.files.length > 0 && (
          <span className={styles.prstat}>
            {pr.files.length} {pr.files.length === 1 ? 'file' : 'files'}
            <span className={styles.add}>+{sum(pr.files, 'added')}</span>
            <span className={styles.del}>−{sum(pr.files, 'removed')}</span>
          </span>
        )}
        {waiting ? (
          <span className={styles.row}>
            <button type="button" className={cx(styles.btn, styles.btnPrimary, styles.btnSm)} disabled={busy} onClick={() => answer.mutate({ id: runId, answer: 'merge' })}>
              Merge
            </button>
            <button type="button" className={cx(styles.btn, styles.btnDanger, styles.btnSm)} disabled={busy} onClick={() => answer.mutate({ id: runId, answer: 'reject' })}>
              Reject
            </button>
          </span>
        ) : (
          badge && <span className={cx(styles.badge, badge === 'merged' && styles.badgeOn, (badge === 'rejected' || badge === 'conflict') && styles.badgeOff)}>{badge}</span>
        )}
      </div>
      {(pr.files.length > 0 || pr.branch) && (
        <div className={styles.prbody}>
          {pr.branch && <span className={styles.branch}>{pr.branch}</span>}
          <Files files={pr.files} />
        </div>
      )}
      {answer.error ? (
        <div className={styles.prbody}>
          <ApiErrorNotice error={answer.error} />
        </div>
      ) : null}
    </section>
  );
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** A project's pull request as the approvals queue lists it: which project and task, what was said, merged or rejected in place. */
export function ProjectWaiting({ run }: { run: BotRun }) {
  const d = run.data;
  const pr: PullRequest = {
    pr_url: text(d.pr_url) || null,
    number: typeof d.number === 'number' ? d.number : null,
    title: text(d.title),
    branch: text(d.branch),
    files: Array.isArray(d.files) ? (d.files as ChangedFile[]) : [],
  };
  const slug = run.project_slug ?? '';
  return (
    <article className={styles.waiting} aria-label={`${slug}: ${run.question?.question ?? 'waiting'}`}>
      <div className={styles.waitingHead}>
        <Link to={projectRunPath(slug, run.id)} className={styles.waitingLink}>
          {slug}
        </Link>
        <span className={styles.dim} title={stamp(run.created_at)}>
          Project · {run.input ? `“${run.input}”` : 'from its instructions'} · {ago(run.created_at)}
        </span>
      </div>
      <p className={styles.waitingAsk}>{run.question?.question}</p>
      {text(d.said) && <p className={styles.said}>{text(d.said)}</p>}
      <PrCard pr={pr} runId={run.id} waiting />
    </article>
  );
}
