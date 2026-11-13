// What a configuration section's chip says, and whether verification may move
// on. Pure data rules, kept out of the component so the wizard's honesty is
// testable without a DOM: a postponement is never a pass, and a deferred AI
// step keeps its section pending even if a later read-back claims otherwise.

import type { Checklist, ChecklistItem, SectionId, SectionView } from './client';

export type SectionChip = 'pending' | 'postponed' | 'applied' | 'verified' | 'risk';

/** The settings route that owns each section, in the installed app. */
export const SECTION_ROUTES: Record<SectionId, string> = {
  agent: '#/configuracion/ia',
  appearance: '#/configuracion/apariencia',
  notifications: '#/configuracion/notificaciones',
  monitoring: '#/configuracion/supervision',
  operational: '#/configuracion/sistema',
};

/** An environment or domain-service value: the wizard explains, it cannot edit. */
export function isLocked(section: SectionView): boolean {
  return section.locked || section.source === 'environment' || section.source === 'domain_service';
}

export function chipFor(section: SectionView, options: { aiDeferred: boolean }): SectionChip {
  // The wizard cannot verify a provider it did not configure. A deferred AI
  // step stays pending here even when a resumed read-back says ``applied``.
  if (section.id === 'agent' && options.aiDeferred) return 'pending';
  switch (section.status) {
    case 'postponed': return 'postponed';
    case 'risk': return 'risk';
    case 'verified': return 'verified';
    case 'applied': return 'applied';
    default: return 'pending';
  }
}

export interface VerifyOutcome {
  passed: number;
  failed: ChecklistItem[];
  missing: ChecklistItem[];
  postponed: ChecklistItem[];
  risk: ChecklistItem[];
  /** Required items that are not passed and not postponed: verification waits. */
  blocked: ChecklistItem[];
}

export function verifyOutcome(checklist: Checklist): VerifyOutcome {
  const passed = checklist.items.filter((item) => item.status === 'passed').length;
  const failed = checklist.items.filter((item) => item.status === 'failed');
  const missing = checklist.items.filter((item) => item.required && item.status === 'pending');
  const postponed = checklist.items.filter((item) => item.status === 'postponed');
  const risk = checklist.items.filter((item) => item.status === 'risk');
  const blocked = checklist.items.filter((item) => item.required
    && (item.status === 'failed' || item.status === 'pending' || item.status === 'risk'));
  return { passed, failed, missing, postponed, risk, blocked };
}

export interface SectionSuggestion {
  section: SectionId;
  value: string;
}

function mentions(answer: string, value: string): boolean {
  const needle = value.toLowerCase();
  if (!needle) return false;
  let index = answer.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? '' : answer[index - 1];
    const after = answer[index + needle.length] ?? '';
    // A closed option id only counts as a mention on its own boundary, so
    // ``prod`` does not match ``produccion``.
    if (!/[a-z0-9_-]/.test(before) && !/[a-z0-9_-]/.test(after)) return true;
    index = answer.indexOf(needle, index + 1);
  }
  return false;
}

/**
 * The assistant only suggests: an option id named in its answer becomes a
 * preview candidate for an unlocked section. Nothing here writes or applies;
 * the caller's only action is to request that preview from the service.
 */
export function suggestionsFor(answer: string | null, sections: SectionView[]): SectionSuggestion[] {
  if (!answer) return [];
  const text = answer.toLowerCase();
  const suggestions: SectionSuggestion[] = [];
  for (const section of sections) {
    if (isLocked(section)) continue;
    const value = section.options.find((option) => option !== section.value && mentions(text, option));
    if (value) suggestions.push({ section: section.id, value });
    if (suggestions.length === 3) break;
  }
  return suggestions;
}
