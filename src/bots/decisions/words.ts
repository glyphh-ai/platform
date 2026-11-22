import type { Decision, Who } from '@/api/botDecisions';

/** 0.18 as `18%`; nothing known as `—`. */
export const pct = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`);

/** Who decided, in words: Ada (from her precedents), you (you were asked) or the gate's default. */
export const whoWords: Record<Who, string> = { ada: 'Ada', you: 'You', default: 'Default' };

/** Why the person was asked, when they were. */
export const modeWords: Record<string, string> = {
  new: 'no precedents yet',
  few: 'too few precedents',
  unsure: 'Ada was unsure',
  audit: 'an audit',
  shadow: 'shadow',
};

/** The outcomes it could be instead of what it is now. */
export const others = (d: Decision) => d.outcomes.filter((o) => o !== d.now);

/** A time as `21 Nov, 09:00`, in the browser's zone. */
export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A field's name as words: `user.login` as `user login`. */
export const fieldName = (name: string) => name.replace(/[._]+/g, ' ');
