import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useBotPlaces } from '@/api/bots';
import { ApiError } from '@/api/client';
import {
  runLive,
  useCancelProjectRun,
  useGitHubKey,
  useProject,
  useProjectRun,
  useProjectRuns,
  useRunProject,
  useUpdateProject,
  type Project,
  type ProjectChange,
  type ProjectRun,
  type Turn,
  type TurnStatus,
} from '@/api/projects';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { ago, dollars, plural, stamp } from '@/lib/format';
import { cx } from '@/lib/cx';
import { Icon } from '@/ui';
import { CLOUD_NOTE, crewChatPath, CrewStrip, endedWords, Face, NO_ROUNDS, PillMenu, placeName, PrCard, repoName, REVIEWS, TURN_MODES, useFaces, type Faces } from './parts';
import { ProjectDialog } from './ProjectDialog';
import styles from './projects.module.css';

const turnWords: Record<TurnStatus, string> = {
  picking: 'choosing',
  running: 'working',
  open: 'open',
  unchanged: 'no changes',
  merging: 'merging',
  merged: 'merged',
  conflict: 'conflict',
  rejecting: 'closing',
  rejected: 'rejected',
  failed: 'failed',
  cancelled: 'cancelled',
};
const chipLook: Partial<Record<TurnStatus, string>> = {
  running: styles.tRunning,
  open: styles.tOpen,
  merged: styles.tMerged,
  rejected: styles.tRejected,
  conflict: styles.tConflict,
};
const runWords: Record<ProjectRun['status'], string> = { running: 'Running', needs_input: 'Waits for you', done: 'Done', failed: 'Failed' };

/** The orchestrator's own closing turn: no bot, it says the project is done. */
const isClosing = (t: Turn) => t.bot_slug === '' && t.status !== 'picking';
const tokens = (n: number) => new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(n).toLowerCase();
const spent = (x: { input_tokens: number; output_tokens: number; cost_micros: number }) =>
  x.input_tokens + x.output_tokens > 0 ? `${tokens(x.input_tokens + x.output_tokens)} tokens · ${dollars(x.cost_micros)}` : '';

/**
 * Reads new turns aloud with the browser's own voice, only while `on` (the project's Narrate when watched) and this
 * view is open and in front. A run mostly goes headless: nothing here speaks unless asked to, and what was already
 * said when the run came into view is never read back.
 */
function useNarration(on: boolean, run: ProjectRun | undefined) {
  const heard = useRef<{ id: string; turns: Set<number> } | null>(null);
  useEffect(() => {
    if (!run) return;
    const said = run.turns.filter((t) => t.said.trim() !== '');
    if (heard.current?.id !== run.id) {
      heard.current = { id: run.id, turns: new Set(said.map((t) => t.n)) };
      return;
    }
    const fresh = said.filter((t) => !heard.current!.turns.has(t.n));
    for (const t of fresh) heard.current.turns.add(t.n);
    if (!on || fresh.length === 0 || document.hidden) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    for (const t of fresh) window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${t.bot_name}. ${t.said}`));
  }, [on, run]);
  // Turned off, or the view closed: whatever is being read stops.
  useEffect(() => {
    if (!on) return;
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [on]);
}

// ------------------------------------------------------------------ the turn chips

/** Each turn as a chip, as the Glyphh Bot app's turn strip: its number, the bot, its pull request and how it went. */
function TurnChips({ run }: { run: ProjectRun }) {
  const turns = run.turns.filter((t) => t.status !== 'picking');
  if (turns.length === 0) return null;
  return (
    <ul className={styles.turnstrip} aria-label="Turns">
      {turns.map((t) => {
        const word = isClosing(t) ? 'done' : turnWords[t.status];
        return (
          <li key={t.n} className={cx(styles.tchip, chipLook[t.status])}>
            <b>{t.n}</b> {t.bot_name || 'Bot'}{' '}
            <small>
              {t.number !== null &&
                (t.pr_url ? (
                  <a href={t.pr_url} target="_blank" rel="noreferrer" aria-label={`Pull request #${t.number} on GitHub`}>
                    #{t.number}
                  </a>
                ) : (
                  <>#{t.number}</>
                ))}{' '}
              <span>{word}</span>
            </small>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ the conversation

function Typing() {
  return (
    <span className={styles.typing} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** One turn as a message from its bot: its cat and name, what it said, its pull request (merged or rejected on it while it waits). */
function TurnMessage({ turn: t, run, faces }: { turn: Turn; run: ProjectRun; faces: Faces }) {
  if (t.status === 'picking')
    return (
      <p className={styles.note} role="status">
        Choosing who goes next… <Typing />
      </p>
    );
  const closing = isClosing(t);
  const live = t.status === 'running';
  const waiting = run.status === 'needs_input' && t.status === 'open';
  const hasPr = t.pr_url !== null || t.number !== null;
  const cost = spent(t);
  return (
    <>
      {t.picked_by === 'orchestrator' && !closing && (
        <p className={styles.note}>
          Orchestrator chose <b>{t.bot_name}</b>
          {t.why && <span className={styles.why}>{t.why}</span>}
        </p>
      )}
      <article className={cx(styles.msg, live && styles.msgLive)} aria-label={`Turn ${t.n}: ${t.bot_name}`}>
        <div className={styles.face}>{closing ? <span className={styles.orch}>O</span> : <Face id={t.bot_id} faces={faces} size={42} busy={live} />}</div>
        <div className={styles.body}>
          <div className={styles.who} title={stamp(t.created_at)}>
            {t.bot_name}
            <span className={styles.turnTag}>turn {t.n}</span>
            {live && <Typing />}
            {t.done && <span className={styles.turnTag}>{closing ? 'done' : 'says it’s done'}</span>}
          </div>
          {live && <p className={styles.dim}>Working{t.branch ? ` on ${t.branch}` : ''}…</p>}
          {t.said ? <p className={styles.bubble}>{t.said}</p> : t.status === 'unchanged' && <p className={styles.dim}>passed</p>}
          {hasPr ? (
            <PrCard pr={t} runId={run.id} waiting={waiting} badge={turnWords[t.status]} />
          ) : (
            !live && !closing && <span className={cx(styles.badge, styles.badgeAlone)}>{t.status === 'unchanged' ? 'No changes' : turnWords[t.status]}</span>
          )}
          {t.error && <p className={styles.err}>{t.error}</p>}
          {cost && <span className={styles.meta}>{cost}</span>}
        </div>
      </article>
    </>
  );
}

/** A run as a conversation: the person's task, each turn a message, how it ended; with review `end`, its one pull request of it all. */
function Conversation({ run, faces, place }: { run: ProjectRun; faces: Faces; place: string }) {
  const box = useRef<HTMLDivElement>(null);
  const size = run.turns.length;
  const last = run.turns.at(-1)?.status;
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.id, size, last, run.status]);
  const whole = run.status === 'needs_input' && run.review === 'end' && run.pr_url !== null && !run.turns.some((t) => t.status === 'open');
  const ended = endedWords(run);
  const total = spent(run);
  return (
    <div className={styles.chat} ref={box} role="log" aria-label="Run">
      <div className={cx(styles.msg, styles.me)}>
        {run.task ? <p className={styles.bubble}>{run.task}</p> : <p className={styles.note}>No task: the crew works from the instructions.</p>}
      </div>
      <p className={styles.note} title={stamp(run.created_at)}>
        {runWords[run.status]} · started {ago(run.created_at)} · on {place}
      </p>
      {run.turns.map((t) => (
        <TurnMessage key={t.n} turn={t} run={run} faces={faces} />
      ))}
      {whole && (
        <div className={styles.whole}>
          <PrCard
            pr={{ pr_url: run.pr_url, number: run.number, title: '', branch: run.work_branch ?? '', files: [] }}
            ask="Merge the whole run?"
            runId={run.id}
            waiting
          />
        </div>
      )}
      {run.status === 'failed' && run.error && <p className={cx(styles.err, styles.errRun)}>{run.error}</p>}
      {!runLive(run.status) && (
        <p className={styles.note}>
          {[ended, plural(size, 'turn'), total].filter(Boolean).join(' · ')}
          {run.status === 'done' && run.pr_url && (
            <>
              {' · '}
              <a href={run.pr_url} target="_blank" rel="noreferrer">
                the run’s pull request{run.number === null ? '' : ` #${run.number}`}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the composer

type ComposerProps = { project: Project; live: ProjectRun | undefined; hero?: boolean; onStarted: (run: ProjectRun) => void };

/**
 * The composer, as the Glyphh Bot app's: the task and a send button, and under it the small pills that set the
 * project (where it runs, who picks the next bot, how it is reviewed, whether it is read aloud). A task may be empty:
 * the crew then works from the instructions alone. While a run is live it says so and offers to cancel it.
 */
function Composer({ project, live, hero, onStarted }: ComposerProps) {
  const places = useBotPlaces();
  const github = useGitHubKey();
  const start = useRunProject(project.slug);
  const update = useUpdateProject(project.slug);
  const cancel = useCancelProjectRun();
  const [task, setTask] = useState('');
  const empty = task.trim() === '';
  const patch = (change: ProjectChange) => update.mutate(change);
  const send = () => {
    if (live || start.isPending) return;
    start.mutate(task.trim(), {
      onSuccess: (r) => {
        setTask('');
        onStarted(r);
      },
    });
  };
  const turn = project.turn_mode === 'wait' ? 'wait' : `orchestrator:${project.orchestrator ?? ''}`;
  const orchestratorName = project.members.find((m) => m.id === project.orchestrator)?.name ?? 'Claude';
  const needsToken = start.error instanceof ApiError && start.error.detail.reason === 'github_key';

  return (
    <div className={cx(styles.composer, hero && styles.composerHero)}>
      {live ? (
        <div className={cx(styles.inputbar, styles.inputbarLive)} role="status">
          <span className={styles.liveDot} aria-hidden="true" />
          <span className={styles.liveText}>
            {live.status === 'needs_input' ? 'A run is going. It waits for your merge or reject.' : 'A run is going. The crew is working.'}
          </span>
          <button type="button" className={cx(styles.btn, styles.btnSm)} disabled={cancel.isPending} onClick={() => cancel.mutate(live.id)}>
            <span aria-hidden="true">■</span> Cancel run
          </button>
        </div>
      ) : (
        <div className={styles.inputbar}>
          <textarea
            rows={1}
            value={task}
            aria-label="Task"
            placeholder="Give the crew a task…"
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {empty && <span className={styles.sendHint}>or start from the instructions</span>}
          <button
            type="button"
            className={styles.send}
            disabled={start.isPending}
            aria-label={empty ? 'Start from the instructions' : 'Start run'}
            title={empty ? 'No task: the crew works from the instructions alone' : 'Start the run'}
            onClick={send}
          >
            ↑
          </button>
        </div>
      )}

      <div className={styles.controls}>
        <PillMenu
          up
          label="Runs on"
          shown={placeName(places.data, project.runs_on)}
          value={project.runs_on}
          busy={update.isPending}
          onPick={(id) => patch({ runs_on: id })}
          options={(places.data ?? []).map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.id === null ? 'Fewer tools: files and pull requests only' : p.linked ? 'Your rrotor: commands, tests and a browser too' : 'Offline',
            disabled: p.id !== null && !p.linked,
          }))}
        />
        <PillMenu
          up
          label="Turn mode"
          shown={project.turn_mode === 'wait' ? 'Wait your turn' : `Orchestrator · ${orchestratorName}`}
          value={turn}
          onPick={(v) => patch(v === 'wait' ? { turn_mode: 'wait', orchestrator: null } : { turn_mode: 'orchestrator', orchestrator: v.slice('orchestrator:'.length) || null })}
          options={[
            { value: 'wait', label: 'Wait your turn', hint: TURN_MODES[0]!.hint.replace(/^[^:]+: /, '') },
            { value: 'orchestrator:', label: 'Orchestrator: Claude', hint: TURN_MODES[1]!.hint.replace(/^[^:]+: /, '') },
            ...project.members.map((m) => ({ value: `orchestrator:${m.id}`, label: `Orchestrator: ${m.name}`, hint: `${m.name} names the next bot and says why` })),
          ]}
        />
        <PillMenu
          up
          label="Review"
          shown={project.review === 'end' ? 'At the end' : 'Each turn'}
          value={project.review}
          onPick={(review) => patch({ review })}
          options={REVIEWS.map((r) => ({ value: r.value, label: r.label, hint: r.hint.replace(/^[^:]+: /, '') }))}
        />
        <button
          type="button"
          className={cx(styles.ctl, project.narrate && styles.ctlOn)}
          aria-pressed={project.narrate}
          title="Reads each new turn aloud while this page is open. Off, and whenever the page is closed, runs are silent."
          onClick={() => patch({ narrate: !project.narrate })}
        >
          <i className={styles.led} aria-hidden="true" /> Narrate when watched
        </button>
      </div>

      {project.runs_on === null && <p className={styles.cloudNote}>{CLOUD_NOTE}</p>}
      {github.data && !github.data.set && (
        <p className={styles.cloudNote}>
          Turns commit and open pull requests with your org’s GitHub token: <Link to="/settings/github-token">set it</Link> before the first run.
        </p>
      )}
      <ApiErrorNotice error={start.error} action={needsToken ? <Link to="/settings/github-token">Set the GitHub token</Link> : undefined} />
      <ApiErrorNotice error={update.error ?? cancel.error} />
    </div>
  );
}

// ------------------------------------------------------------------ the view

export type ProjectViewProps = {
  slug: string;
  /** The run shown; none shows the newest. Leave it out and the view keeps its own choice. */
  run?: string | null;
  onRun?: (id: string) => void;
  /** The project was deleted from its settings. */
  onDeleted?: () => void;
};

/**
 * One project, in the Glyphh Bot app's crew look, with no page around it: the crew strip (its cats and names) and the
 * shown run's turn chips on top; the run as a conversation in the centre (the person's task, each turn a message with
 * its pull request); the composer at the bottom, which starts a run and sets the project. Its settings open in a
 * modal from the gear. Give it a height: the conversation scrolls inside it.
 */
export function ProjectView({ slug, run: given, onRun, onDeleted }: ProjectViewProps) {
  const project = useProject(slug);
  const runs = useProjectRuns(slug);
  const places = useBotPlaces();
  const faces = useFaces();
  const [own, setOwn] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const shownId = (given === undefined ? own : given) ?? runs.data?.[0]?.id ?? null;
  const shown = useProjectRun(shownId);
  const show = (id: string) => (onRun ? onRun(id) : setOwn(id));
  const p = project.data;
  const run = shown.data;
  useNarration(p?.narrate ?? false, run);

  if (project.isPending) return <div className={styles.view} aria-busy="true" aria-label="Loading the project" />;
  if (!p)
    return (
      <div className={styles.view}>
        <ApiErrorNotice error={project.error} />
      </div>
    );

  // The run that is going: the shown run is read more often than the list, so where they are the same run it is believed.
  const listed = runs.data?.find((r) => runLive(r.status));
  const live = run && (run.id === listed?.id || runLive(run.status)) ? (runLive(run.status) ? run : undefined) : listed;
  const working = run?.status === 'running' ? run.turns.at(-1) : undefined;
  const composer = <Composer project={p} live={live} hero={!shownId} onStarted={(r) => show(r.id)} />;

  return (
    <section className={styles.view} aria-label={p.name}>
      <header className={styles.roomHead}>
        <div className={styles.solo}>
          <h1>{p.name}</h1>
          <span>
            <a href={p.repo_url} target="_blank" rel="noreferrer">
              {repoName(p.repo_url)}
            </a>{' '}
            · {p.base_branch}
          </span>
        </div>
        <div className={styles.stage}>
          <CrewStrip members={p.members} faces={faces} up={working?.bot_id}>
            {run && runLive(run.status) ? (run.status === 'needs_input' ? 'Waits for you' : `Run · turn ${run.turns.length}`) : null}
          </CrewStrip>
          {run && <TurnChips run={run} />}
        </div>
        <div className={styles.tools}>
          {runs.data && runs.data.length > 1 && (
            <PillMenu
              end
              label="Runs"
              shown={String(runs.data.length)}
              value={shownId}
              onPick={(id) => id && show(id)}
              options={runs.data.map((r) => ({ value: r.id as string | null, label: r.task || 'From the instructions', hint: `${runWords[r.status]} · ${plural(r.turns.length, 'turn')} · ${ago(r.created_at)}` }))}
            />
          )}
          <Link to={crewChatPath(p.slug)} className={styles.chatLink} title="The crew’s chat in Bots">
            Open in Bots
          </Link>
          <button type="button" className={styles.iconBtn} aria-label="Project settings" title="Project settings" onClick={() => setSettings(true)}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </header>

      <ApiErrorNotice error={runs.error ?? shown.error} />
      {shownId ? (
        run ? (
          <Conversation run={run} faces={faces} place={placeName(places.data, run.runs_on)} />
        ) : (
          <div className={styles.chat} aria-busy={shown.isPending || undefined} />
        )
      ) : (
        <div className={styles.heroWrap}>
          <div className={styles.heroCrew} aria-hidden="true">
            {p.members.map((m) => (
              <Face key={m.id} id={m.id} faces={faces} size={96} mode="full" />
            ))}
          </div>
          <div className={styles.floor} />
          <h2 className={styles.headline}>What are we making?</h2>
          <p className={styles.sub}>
            Give the crew a task, or send nothing and they work from the instructions. {NO_ROUNDS}.
          </p>
          {composer}
        </div>
      )}
      {shownId && composer}

      <ProjectDialog open={settings} onClose={() => setSettings(false)} project={p} onDeleted={onDeleted} />
    </section>
  );
}
