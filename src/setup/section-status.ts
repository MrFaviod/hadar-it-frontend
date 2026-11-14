// What a configuration section's chip says, and whether verification may move
// on. Pure data rules, kept out of the component so the wizard's honesty is
// testable without a DOM: the service's own statuses are the only words shown,
// a postponement and an accepted risk are never a pass, and a deferred AI step
// keeps its section pending even if a later read-back claims otherwise.

import type {
  Checklist,
  ChecklistItem,
  SectionData,
  SectionDetail,
  SectionField,
  SectionId,
  SectionSummary,
} from './client';

/**
 * The service's stored statuses: ``passed`` is the only green one. ``declared``
 * is a stated policy the service records as itself — never a pass, never a
 * risk.
 */
export type SectionChip = 'pending' | 'passed' | 'postponed' | 'risk' | 'declared';

/** The settings route that owns each section, in the installed app. */
export const SECTION_ROUTES: Record<SectionId, string> = {
  agent: '#/configuracion/ia',
  appearance: '#/configuracion/apariencia',
  notifications: '#/configuracion/notificaciones',
  monitoring: '#/configuracion/supervision',
  operational: '#/configuracion/sistema',
};

export function chipFor(section: SectionSummary, options: { aiDeferred: boolean }): SectionChip {
  // The wizard cannot verify a provider it did not configure. A deferred AI
  // step stays pending here even when a resumed read-back says ``passed``.
  if (section.section === 'agent' && options.aiDeferred) return 'pending';
  return section.status;
}

function dataText(value: string | number | boolean | string[] | null): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return null;
}

/** The live value flattened for display; arrays are shown as their ids. */
export function currentRows(section: SectionDetail): SectionField[] {
  const current: SectionData | null = section.current;
  if (!current) return [];
  const rows: SectionField[] = [];
  for (const [field, value] of Object.entries(current)) {
    const printed = dataText(value);
    if (printed !== null) rows.push({ field, value: printed });
  }
  return rows;
}

/**
 * Closed option ids a section offers. The service publishes the appearance
 * presets in the live value; every other section takes free values, so the
 * wizard asks for them as fields rather than inventing a list.
 */
export function choicesFor(section: { section: SectionId; current: SectionData | null }): string[] {
  if (section.section !== 'appearance') return [];
  const ids = section.current?.builtinIds;
  return Array.isArray(ids) ? ids.filter((entry): entry is string => typeof entry === 'string') : [];
}

export interface VerifyOutcome {
  passed: number;
  failed: ChecklistItem[];
  missing: ChecklistItem[];
  postponed: ChecklistItem[];
  risk: ChecklistItem[];
  /** A stated policy the service recorded as ``declared``; not a pass. */
  declared: ChecklistItem[];
  /** Required items the service flags as blocking: verification waits. */
  blocked: ChecklistItem[];
}

export function verifyOutcome(checklist: Checklist): VerifyOutcome {
  const passed = checklist.items.filter((item) => item.status === 'passed').length;
  const failed = checklist.items.filter((item) => item.status === 'failed');
  const missing = checklist.items.filter(
    (item) => item.required && item.status === 'pending' && !item.acceptedRisk,
  );
  const postponed = checklist.items.filter((item) => item.status === 'postponed');
  const risk = checklist.items.filter((item) => item.status === 'risk');
  const declared = checklist.items.filter((item) => item.status === 'declared');
  // ``blocking`` is the service's verdict, not a re-derivation here: a
  // required item that is not satisfied blocks, an accepted risk does not.
  const blocked = checklist.items.filter((item) => item.blocking);
  return { passed, failed, missing, postponed, risk, declared, blocked };
}

/**
 * Whether the installation's agent selection is linked to a global provider
 * record: the live value first, the recorded receipt second, and ``null`` when
 * the service answered neither. The page says "unknown", never "yes".
 */
export function providerRecord(
  section: { current: SectionData | null },
  receipt: { receipt: SectionData | null } | null,
): boolean | null {
  const live = section.current?.provider_record;
  if (typeof live === 'boolean') return live;
  const recorded = receipt?.receipt?.provider_record;
  return typeof recorded === 'boolean' ? recorded : null;
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
 * The assistant only suggests: a preset id named in its answer becomes a
 * preview candidate for the appearance section. Nothing here writes or
 * applies; the caller's only action is to request that preview.
 */
export function suggestionsFor(
  answer: string | null,
  sections: Array<{ section: SectionId; current: SectionData | null }>,
): SectionSuggestion[] {
  if (!answer) return [];
  const text = answer.toLowerCase();
  const suggestions: SectionSuggestion[] = [];
  for (const section of sections) {
    const current = section.current?.preset;
    const value = choicesFor(section).find(
      (option) => option !== current && mentions(text, option),
    );
    if (value) suggestions.push({ section: section.section, value });
    if (suggestions.length === 3) break;
  }
  return suggestions;
}
