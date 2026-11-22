import { Link, useNavigate, useSearchParams } from 'react-router';
import { useBotPlaces, type Place } from '@/api/bots';
import { useProjects, type Project } from '@/api/projects';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { cx } from '@/lib/cx';
import { crewChatPath, Face, placeName, repoName, reviewWords, turnWords, useFaces, type Faces } from './parts';
import { ProjectDialog } from './ProjectDialog';
import styles from './projects.module.css';

/** A project in the list: its name, repo and base, the crew's cats, where it runs, who picks the next bot and how it is reviewed. */
function ProjectCard({ project: p, faces, places }: { project: Project; faces: Faces; places: Place[] | undefined }) {
  const title = `project-${p.slug}`;
  return (
    <li>
      {/* A project opens as its crew's chat in the Bots area. */}
      <Link to={crewChatPath(p.slug)} className={styles.card} aria-labelledby={title}>
        <div className={styles.cardTop}>
          <span className={styles.minis} aria-hidden="true">
            {p.members.map((m) => (
              <span key={m.id} className={styles.mini}>
                <Face id={m.id} faces={faces} size={30} />
              </span>
            ))}
          </span>
          <span className={styles.pill}>
            <span className={cx(styles.dot, p.runs_on === null && styles.dotCloud)} aria-hidden="true" />
            On {placeName(places, p.runs_on)}
          </span>
        </div>
        <h2 id={title} className={styles.cardName}>
          {p.name}
        </h2>
        <span className={styles.cardRepo}>
          {repoName(p.repo_url)} · {p.base_branch}
        </span>
        <p className={styles.cardCrew}>{p.members.map((m) => m.name).join(', ') || 'No bots in the crew'}</p>
        <span className={styles.cardMode}>
          {turnWords(p)} · {reviewWords(p.review)}
        </span>
      </Link>
    </li>
  );
}

/**
 * The org's projects, in the Glyphh Bot app's look: a card each. New project opens the modal (`?new=1` opens it too).
 */
export function ProjectsPage() {
  const projects = useProjects();
  const places = useBotPlaces();
  const faces = useFaces();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const making = params.get('new') === '1';
  const make = () => setParams({ new: '1' }, { replace: true });
  return (
    <div className={styles.listPage}>
      <header className={styles.listHead}>
        <div className={styles.headText}>
          <span className={styles.label}>Glyphh bots</span>
          <h1 className={styles.listTitle}>Projects</h1>
          <p className={styles.listSub}>
            A crew of your bots working on one GitHub repo, from the repo and your instructions. Who goes next is decided as the work goes, and every change is a
            pull request you merge or reject.
          </p>
        </div>
        <button type="button" className={cx(styles.btn, styles.btnPrimary, styles.btnPill)} onClick={make}>
          <span aria-hidden="true">+</span> New project
        </button>
      </header>
      <ApiErrorNotice error={projects.error} />
      {projects.isPending && <div className={styles.cardGhost} aria-busy="true" aria-label="Loading projects" />}
      {projects.data?.length === 0 && (
        <div className={styles.empty}>
          <h2>No projects yet</h2>
          <p>
            A project is a crew of your bots on one GitHub repo. They read the repo and your instructions, take turns as the work needs, and run until the crew
            says it’s done. Each change is a pull request that waits for you.
          </p>
          <button type="button" className={styles.newCard} onClick={make}>
            + New project
          </button>
        </div>
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className={styles.cards} aria-label="Projects">
          {projects.data.map((p) => (
            <ProjectCard key={p.id} project={p} faces={faces} places={places.data} />
          ))}
        </ul>
      )}
      <ProjectDialog open={making} onClose={() => setParams({}, { replace: true })} onMade={(p) => navigate(crewChatPath(p.slug))} />
    </div>
  );
}
