import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useBotPlaces, useBots } from '@/api/bots';
import { useCreateProject, useDeleteProject, useGitHubKey, useUpdateProject, type NewProject, type Project, type Review, type TurnMode } from '@/api/projects';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cx } from '@/lib/cx';
import { CLOUD_NOTE, Face, Modal, NO_ROUNDS, REVIEWS, TURN_MODES, useFaces } from './parts';
import styles from './projects.module.css';

type Choice<T> = { value: T; label: string; disabled?: boolean };

/** One of a few, as pills: the chosen one is white. */
function Choices<T>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<Choice<T>>; onChange: (v: T) => void }) {
  return (
    <div className={styles.choices} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled} className={styles.choice} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** The project to change; none makes a new one. */
  project?: Project;
  onMade?: (p: Project) => void;
  onDeleted?: () => void;
};

/**
 * A new project, or a project's settings, as one small modal: its name and repo, the crew (cats clicked in and out, a
 * set with no order), the brief, where it runs, who picks the next bot and how it is reviewed. Under Advanced: the
 * base branch, the instructions file and the safety caps.
 */
export function ProjectDialog({ open, onClose, project, onMade, onDeleted }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={project ? 'Project settings' : 'New project'}>
      <Form key={project?.updated_at ?? 'new'} project={project} onClose={onClose} onMade={onMade} onDeleted={onDeleted} />
    </Modal>
  );
}

function Form({ project, onClose, onMade, onDeleted }: Omit<Props, 'open'>) {
  const bots = useBots();
  const places = useBotPlaces();
  const github = useGitHubKey();
  const faces = useFaces();
  const create = useCreateProject();
  const update = useUpdateProject(project?.slug ?? '');
  const remove = useDeleteProject();
  const [name, setName] = useState(project?.name ?? '');
  const [repo, setRepo] = useState(project?.repo_url ?? '');
  const [members, setMembers] = useState<string[]>(project?.members.map((m) => m.id) ?? []);
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [runsOn, setRunsOn] = useState<string | null>(project?.runs_on ?? null);
  const [mode, setMode] = useState<TurnMode>(project?.turn_mode ?? 'wait');
  const [orchestrator, setOrchestrator] = useState<string | null>(project?.orchestrator ?? null);
  const [review, setReview] = useState<Review>(project?.review ?? 'each_turn');
  const [advanced, setAdvanced] = useState(false);
  const [base, setBase] = useState(project?.base_branch ?? 'main');
  const [path, setPath] = useState(project?.instructions_path ?? 'PROJECT.md');
  const [turns, setTurns] = useState(String(project?.max_turns ?? 30));
  const [spend, setSpend] = useState(project?.max_spend_cents == null ? '' : (project.max_spend_cents / 100).toFixed(2));
  const [deleting, setDeleting] = useState(false);

  // A set: the crew is sent in the bots' own order, whatever order the cats were clicked in.
  const all = bots.data ?? [];
  const known = new Map<string, string>([...(project?.members ?? []).map((m) => [m.id, m.name] as const), ...all.map((b) => [b.id, b.name] as const)]);
  const crew = [...all.map((b) => b.id).filter((id) => members.includes(id)), ...members.filter((id) => !all.some((b) => b.id === id))];
  const toggle = (id: string) => {
    const next = members.includes(id) ? members.filter((x) => x !== id) : [...members, id];
    setMembers(next);
    if (orchestrator && !next.includes(orchestrator)) setOrchestrator(null);
  };
  const maxTurns = Number(turns);
  const cents = spend.trim() === '' ? null : Math.round(Number(spend) * 100);
  const capsOk = Number.isInteger(maxTurns) && maxTurns >= 1 && (cents === null || (Number.isFinite(cents) && cents > 0));
  const ready = name.trim() !== '' && repo.trim() !== '' && crew.length > 0 && base.trim() !== '' && path.trim() !== '' && capsOk;
  const body = (): NewProject => ({
    name: name.trim(),
    repo_url: repo.trim(),
    base_branch: base.trim(),
    members: crew,
    instructions: instructions.trim(),
    instructions_path: path.trim(),
    turn_mode: mode,
    orchestrator: mode === 'orchestrator' ? orchestrator : null,
    review,
    runs_on: runsOn,
    max_turns: maxTurns,
    max_spend_cents: cents,
  });
  const save = () => {
    if (project) update.mutate(body(), { onSuccess: onClose });
    else create.mutate(body(), { onSuccess: (p) => onMade?.(p) });
  };
  const saving = create.isPending || update.isPending;
  const file = path.trim() || 'PROJECT.md';

  return (
    <div className={styles.form}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Site crew" maxLength={80} />
      </label>
      <label>
        GitHub repo
        <input className={styles.monoInput} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/acme/site" spellCheck={false} />
      </label>

      <Group label="Crew">
        {all.length === 0 && bots.data ? (
          <small>
            You have no bots yet. <Link to="/bots">Make one</Link>, then put it on a project.
          </small>
        ) : (
          <div className={styles.pick} role="group" aria-label="Crew">
            {all.map((b) => (
              <button key={b.id} type="button" aria-pressed={members.includes(b.id)} className={styles.pickCat} onClick={() => toggle(b.id)}>
                <span className={styles.pickFace}>
                  <Face id={b.id} faces={faces} size={44} />
                </span>
                {b.name}
              </button>
            ))}
          </div>
        )}
        <small>Click a cat to put it in or take it out. There is no order: who goes next is decided as the work goes.</small>
        <ApiErrorNotice error={bots.error} />
      </Group>

      <label>
        Instructions
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="What this project is for and how the crew should work on it."
        />
        <small>The crew’s brief, read before every turn. A {file} in the repo is read too.</small>
      </label>

      <Group label="Runs on">
        <Choices
          label="Runs on"
          value={runsOn}
          onChange={setRunsOn}
          options={(places.data ?? [{ id: null, name: 'Glyphh cloud', mode: 'cloud', linked: true }]).map((p) => ({
            value: p.id,
            label: p.linked || p.id === null ? p.name : `${p.name} (offline)`,
            disabled: p.id !== null && !p.linked && p.id !== runsOn,
          }))}
        />
        {runsOn === null && <small className={styles.cloudNote}>{CLOUD_NOTE}</small>}
      </Group>

      <Group label="Turn mode">
        <Choices label="Turn mode" value={mode} onChange={setMode} options={TURN_MODES} />
        <small>{TURN_MODES.find((m) => m.value === mode)?.hint}</small>
        {mode === 'orchestrator' && (
          <>
            <Choices
              label="Orchestrator"
              value={orchestrator}
              onChange={setOrchestrator}
              options={[{ value: null, label: 'Claude' }, ...crew.map((id) => ({ value: id as string | null, label: known.get(id) ?? 'A bot deleted since' }))]}
            />
            <small>Who picks: Claude, or one of the crew’s own bots.</small>
          </>
        )}
      </Group>

      <Group label="Review">
        <Choices label="Review" value={review} onChange={setReview} options={REVIEWS} />
        <small>{REVIEWS.find((r) => r.value === review)?.hint}</small>
      </Group>

      <small className={styles.plain}>{NO_ROUNDS}; a safety cap is under Advanced.</small>

      <button type="button" className={cx(styles.disclose, advanced && styles.discloseOpen)} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        Advanced
      </button>
      {advanced && (
        <div className={styles.two}>
          <label>
            Base branch
            <input className={styles.monoInput} value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} />
            <small>Turns start from it and merge into it.</small>
          </label>
          <label>
            Instructions file
            <input className={styles.monoInput} value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
            <small>Read from the repo before every turn.</small>
          </label>
          <label>
            Max turns
            <input type="number" min={1} step={1} value={turns} onChange={(e) => setTurns(e.target.value)} />
            <small>The safety cap: a run stops here if no one has said it’s done.</small>
          </label>
          <label>
            Max spend in dollars
            <input inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="No cap" />
            <small>Optional: a run stops once it has cost this much.</small>
          </label>
        </div>
      )}

      {github.data && !github.data.set && (
        <small className={styles.plain}>
          Turns commit and open pull requests with your org’s GitHub token: <Link to="/settings/github-token">set it</Link> before the first run.
        </small>
      )}
      <ApiErrorNotice error={create.error ?? update.error} />

      <div className={styles.modalActions}>
        {project && (
          <button type="button" className={cx(styles.btn, styles.btnDanger, styles.pushLeft)} onClick={() => setDeleting(true)}>
            Delete project
          </button>
        )}
        <button type="button" className={styles.btn} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={cx(styles.btn, styles.btnPrimary)} disabled={!ready || saving} aria-busy={saving || undefined} onClick={save}>
          {project ? 'Save' : 'Make project'}
        </button>
      </div>

      {project && (
        <ConfirmDialog
          open={deleting}
          title={`Delete ${project.name}?`}
          description="Its runs go with it. The branches and pull requests stay on GitHub."
          confirmLabel="Delete"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(project.slug, { onSuccess: () => onDeleted?.() })}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
