// Configuration and verification panels for the first-start wizard.
//
// Each panel shows what the service says the section holds right now, what it
// recorded for it, and — for the sections the service exposes an editor for —
// the values a change would apply. A preview never writes; applying is a
// second, explicit click. The production backup is the one item that can be
// accepted as a risk, and it is shown as exactly that: an amber "risk accepted"
// record, never a green pass.

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type {
  AiDiagnosticCode,
  Checklist,
  ChecklistItem,
  CompletionCode,
  ConfigurationDiagnosticCode,
  SectionDecision,
  SectionDetail,
  SectionId,
  SectionInput,
  SectionPreview,
  SetupReport,
} from './client';
import { SECTION_ROUTES, chipFor, choicesFor, currentRows, providerRecord, suggestionsFor, type SectionChip } from './section-status';
import { AgentProviderRecord, OperationalForms } from './gap-panels';
import { organizationNameError } from './gap-forms';
import type { Translator } from './strings';
import '../../assets/css/setup.css';

const CHIP_LABEL: Record<SectionChip, string> = {
  pending: 'ui.setup.config.chip.pending',
  passed: 'ui.setup.config.chip.applied',
  postponed: 'ui.setup.config.chip.postponed',
  risk: 'ui.setup.config.chip.risk',
  declared: 'ui.setup.config.chip.declared',
};

const CHECK_LABEL: Record<string, string> = {
  passed: 'ui.setup.verify.status.passed',
  failed: 'ui.setup.verify.status.failed',
  pending: 'ui.setup.verify.status.pending',
  postponed: 'ui.setup.verify.status.postponed',
  risk: 'ui.setup.verify.status.risk',
  declared: 'ui.setup.verify.status.declared',
  applied: 'ui.setup.config.chip.applied',
  unavailable: 'ui.setup.verify.status.unavailable',
  not_required: 'ui.setup.verify.status.not_required',
};

/** Why the organization name the operator typed cannot be sent. */
const ORG_ERROR: Record<string, string> = {
  control: 'ui.setup.config.error.field_control',
  too_long: 'ui.setup.config.error.field_too_long',
  charset: 'ui.setup.config.error.field_charset',
};

/** Checklist ids the contract defines; anything else is shown as data. */
const KNOWN_ITEMS = new Set([
  'setup_enabled', 'claim_completed', 'ai_explicit', 'database_ready', 'migrated',
  'owner_present', 'origin_valid', 'session_valid', 'worker_ready', 'storage_ready',
  'appearance_decided', 'backup_policy_declared', 'smtp', 'monitoring',
  'external_search', 'external_engines', 'integrations',
]);

const CONFIG_ERROR: Record<ConfigurationDiagnosticCode, string> = {
  confirm_required: 'ui.setup.config.error.confirm_required',
  state_refused: 'ui.setup.config.error.state_refused',
  invalid_request: 'ui.setup.config.error.invalid_request',
  permission_denied: 'ui.setup.config.error.permission_denied',
  verification_blocked: 'ui.setup.config.error.verification_blocked',
  session_expired: 'ui.setup.config.error.session_expired',
  unavailable: 'ui.setup.config.error.unavailable',
  network: 'ui.setup.config.error.network',
  timeout: 'ui.setup.config.error.timeout',
  'invalid-response': 'ui.setup.config.error.invalid_response',
};

type FieldKind = 'text' | 'select' | 'toggle';

interface FieldSpec {
  name: string;
  kind: FieldKind;
}

// The values each editable section accepts through the generic editor.
// Operational is not here: its declaration and origin/session editors own
// their own forms and preview/apply actions.
const SECTION_FIELDS: Partial<Record<SectionId, FieldSpec[]>> = {
  appearance: [{ name: 'preset', kind: 'select' }, { name: 'organizationName', kind: 'text' }],
  agent: [{ name: 'provider', kind: 'text' }, { name: 'model', kind: 'text' }],
  notifications: [{ name: 'kind', kind: 'text' }, { name: 'name', kind: 'text' }, { name: 'enabled', kind: 'toggle' }],
  monitoring: [{ name: 'category', kind: 'text' }, { name: 'checkType', kind: 'text' }, { name: 'enabled', kind: 'toggle' }],
};

function seedDraft(section: SectionDetail, fields: FieldSpec[]): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const field of fields) {
    const raw = section.current?.[field.name];
    draft[field.name] = typeof raw === 'boolean' ? String(raw) : typeof raw === 'string' ? raw : '';
  }
  return draft;
}

function valuesOf(fields: FieldSpec[], draft: Record<string, string>): SectionInput {
  const values: SectionInput = {};
  for (const field of fields) {
    if (field.kind === 'toggle') {
      values[field.name] = draft[field.name] !== 'false';
      continue;
    }
    const value = (draft[field.name] ?? '').trim();
    if (value) values[field.name] = value;
  }
  return values;
}

export function configurationMessage(code: ConfigurationDiagnosticCode, t: Translator): string {
  return t(CONFIG_ERROR[code]);
}

export function checklistLabel(id: string, t: Translator): string {
  return KNOWN_ITEMS.has(id) ? t(`ui.setup.verify.item.${id}`) : id;
}

function checkLabel(status: string, t: Translator): string {
  const key = CHECK_LABEL[status];
  return key ? t(key) : status;
}

export interface AssistantView {
  answer: string | null;
  tools: string[];
  latency: number | null;
  asking: boolean;
  error: AiDiagnosticCode | 'form-incomplete' | null;
}

export interface ConfigurationPanelProps {
  t: Translator;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  sections: SectionDetail[];
  mode: string | null;
  loading: boolean;
  error: ConfigurationDiagnosticCode | null;
  busy: SectionId | null;
  previews: Partial<Record<SectionId, SectionPreview>>;
  receipts: Partial<Record<SectionId, SectionDecision>>;
  blocked: ChecklistItem[] | null;
  riskItem: ChecklistItem | null;
  aiDeferred: boolean;
  appUsable: boolean;
  verifying: boolean;
  verifyError: ConfigurationDiagnosticCode | null;
  assistant: AssistantView;
  onPreview: (section: SectionId, values: SectionInput) => void;
  onApply: (section: SectionId, values: SectionInput) => void;
  /** The operational declaration: action ``declare``, never an apply. */
  onDeclare: (section: SectionId, values: SectionInput) => void;
  onDiscard: (section: SectionId) => void;
  onPostpone: (section: SectionId) => void;
  onAcceptRisk: (section: SectionId, item: string, reason: string) => void;
  onVerify: () => void;
  onReload: () => void;
  onAsk: (question: string) => void;
}

export function ConfigurationPanel(props: ConfigurationPanelProps) {
  const { t, sections, blocked, error, verifyError, appUsable } = props;
  const errorRef = useRef<HTMLDivElement>(null);
  const blockedRef = useRef<HTMLDivElement>(null);
  const verifyErrorRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (blocked) blockedRef.current?.focus();
  }, [blocked]);

  useEffect(() => {
    if (verifyError) verifyErrorRef.current?.focus();
  }, [verifyError]);

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.assistant.asking) return;
    const value = question.trim();
    if (!value) return;
    props.onAsk(value);
    setQuestion('');
  }

  const suggestions = suggestionsFor(props.assistant.answer, sections);

  return (
    <section className="setup__ai" aria-labelledby="setup-config-title" data-setup-panel="configure">
      <h2 id="setup-config-title" tabIndex={-1} ref={props.headingRef}>{t('ui.setup.config.title')}</h2>
      <p className="setup__lead">{t('ui.setup.config.lead')}</p>

      <div className="setup__messages" aria-live="polite" aria-atomic="true">
        {props.loading ? <p className="field__hint" role="status" data-setup-config="loading">{t('ui.setup.config.loading')}</p> : null}
        {error ? (
          <div className="form-alert" role="alert" tabIndex={-1} ref={errorRef} data-setup-config-error={error}>
            <span>{configurationMessage(error, t)}</span>
            <button className="btn btn--secondary" type="button" onClick={props.onReload}>
              {t('ui.setup.config.reload')}
            </button>
          </div>
        ) : null}
        {verifyError ? (
          <div className="form-alert" role="alert" tabIndex={-1} ref={verifyErrorRef} data-setup-config="verify-error">
            {configurationMessage(verifyError, t)}
          </div>
        ) : null}
        {blocked ? (
          <div className="form-alert" role="alert" tabIndex={-1} ref={blockedRef} data-setup-config="blocked">
            <div>
              <p>{t('ui.setup.config.blocked_title')}</p>
              {blocked.length > 0 ? (
                <ul className="setup-config__blocked">
                  {blocked.map((item) => (
                    <li key={item.id}>
                      <span>{checklistLabel(item.id, t)}</span>{' '}
                      <span className="setup-step__badge" data-setup-chip={item.status}>{checkLabel(item.status, t)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p>{t('ui.setup.config.blocked_unknown')}</p>}
              <p className="field__hint">{t('ui.setup.config.blocked_help')}</p>
            </div>
          </div>
        ) : null}
      </div>

      {sections.map((section) => (
        <SectionCard
          key={section.section}
          t={t}
          section={section}
          mode={props.mode}
          chip={chipFor(section, { aiDeferred: props.aiDeferred })}
          preview={props.previews[section.section] ?? null}
          receipt={props.receipts[section.section] ?? null}
          riskItem={props.riskItem}
          busy={props.busy === section.section}
          appUsable={appUsable}
          onPreview={props.onPreview}
          onApply={props.onApply}
          onDeclare={props.onDeclare}
          onDiscard={props.onDiscard}
          onPostpone={props.onPostpone}
          onAcceptRisk={props.onAcceptRisk}
        />
      ))}

      <div className="setup__ai-actions">
        <button
          className="btn btn--primary"
          type="button"
          id="setup-verify-submit"
          onClick={props.onVerify}
          disabled={props.verifying || props.loading}
        >
          {props.verifying ? t('ui.setup.config.verifying') : t('ui.setup.config.verify')}
        </button>
      </div>
      <p className="field__hint">{t('ui.setup.config.verify_hint')}</p>

      <details className="setup-config__assistant" data-setup-config-assistant>
        <summary>{t('ui.setup.config.assistant_title')}</summary>
        <p className="field__hint">{t('ui.setup.config.assistant_lead')}</p>
        <form className="setup-config__row" onSubmit={ask}>
          <div className="field">
            <label htmlFor="setup-config-question">{t('ui.setup.config.assistant_label')}</label>
            <div className="input-shell">
              <input
                id="setup-config-question"
                name="setup-question"
                type="text"
                value={question}
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>
          </div>
          <button className="btn btn--secondary" type="submit" id="setup-config-ask" disabled={props.assistant.asking}>
            {props.assistant.asking ? t('ui.setup.config.assistant_asking') : t('ui.setup.config.assistant_submit')}
          </button>
        </form>
        <div className="setup__messages" aria-live="polite" aria-atomic="true">
          {props.assistant.error ? (
            <p className="form-alert" role="alert" data-setup-config="assistant-error">
              {t(props.assistant.error === 'form-incomplete'
                ? 'ui.setup.ai.form_incomplete'
                : `ui.setup.ai.error.${props.assistant.error.replace(/-/g, '_')}`)}
            </p>
          ) : null}
        </div>
        {props.assistant.answer ? (
          <div className="setup__assistant-answer" data-setup-config="assistant-answer">
            <h4>{t('ui.setup.config.assistant_answer_title')}</h4>
            <p className="setup__assistant-text">{props.assistant.answer}</p>
            {suggestions.length > 0 ? (
              <div className="setup__ai-actions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.section}
                    className="btn btn--secondary"
                    type="button"
                    data-setup-config-suggestion={`${suggestion.section}:${suggestion.value}`}
                    onClick={() => props.onPreview(suggestion.section, { preset: suggestion.value })}
                  >
                    {t('ui.setup.config.suggestion', {
                      value: suggestion.value,
                      section: t(`ui.setup.config.section.${suggestion.section}`),
                    })}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="field__hint">{t('ui.setup.config.suggestion_hint')}</p>
          </div>
        ) : null}
      </details>
    </section>
  );
}

interface SectionCardProps {
  t: Translator;
  section: SectionDetail;
  mode: string | null;
  chip: SectionChip;
  preview: SectionPreview | null;
  receipt: SectionDecision | null;
  riskItem: ChecklistItem | null;
  busy: boolean;
  appUsable: boolean;
  onPreview: (section: SectionId, values: SectionInput) => void;
  onApply: (section: SectionId, values: SectionInput) => void;
  onDeclare: (section: SectionId, values: SectionInput) => void;
  onDiscard: (section: SectionId) => void;
  onPostpone: (section: SectionId) => void;
  onAcceptRisk: (section: SectionId, item: string, reason: string) => void;
}

function receiptRows(receipt: SectionDecision | null) {
  if (!receipt?.receipt) return [];
  return Object.entries(receipt.receipt).flatMap(([field, value]) => {
    if (typeof value === 'string') return [{ field, value }];
    if (typeof value === 'number' || typeof value === 'boolean') return [{ field, value: String(value) }];
    return [];
  });
}

function SectionCard(props: SectionCardProps) {
  const { t, section, chip, preview, receipt, busy } = props;
  const fields = SECTION_FIELDS[section.section] ?? [];
  const [draft, setDraft] = useState<Record<string, string>>(() => seedDraft(section, fields));
  const [riskReason, setRiskReason] = useState('');
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const lastPreview = useRef<string | null>(null);
  const lastReceipt = useRef<string | null>(null);

  const label = t(`ui.setup.config.section.${section.section}`);
  const route = SECTION_ROUTES[section.section];
  const choices = choicesFor(section);
  const current = currentRows(section);
  const readback = receiptRows(receipt);
  const values = valuesOf(fields, draft);
  const dirty = fields.some((field) => {
    const before = section.current?.[field.name];
    const seeded = typeof before === 'boolean' ? String(before) : typeof before === 'string' ? before : '';
    return (draft[field.name] ?? '') !== seeded;
  });
  // The organization name is the one value here the page can judge before the
  // service sees it: bounded, printable, from the allowed set and optional.
  const orgError = fields.some((field) => field.name === 'organizationName')
    ? organizationNameError(draft.organizationName ?? '')
    : null;
  const canPreview = fields.length > 0 && Object.keys(values).length > 0 && dirty && !busy && orgError === null;
  const inputId = (name: string, kind: FieldKind) => (fields.length === 1 || kind === 'select'
    ? `setup-config-input-${section.section}`
    : `setup-config-input-${section.section}-${name}`);
  const formErrorId = `setup-config-form-error-${section.section}`;

  // The service is the authority on the stored values: a refresh replaces the
  // draft so the form never keeps a value the read-back no longer reports.
  const currentSignature = JSON.stringify(section.current ?? null);
  useEffect(() => {
    setDraft(seedDraft(section, fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSignature, section.section]);

  // Focus follows the result, not the click: a preview and an apply receipt
  // arrive from the service asynchronously, and each is the next thing to read.
  useEffect(() => {
    const signature = preview ? `${preview.section}:${JSON.stringify(preview.proposed)}` : null;
    if (signature && signature !== lastPreview.current) previewRef.current?.focus();
    lastPreview.current = signature;
  }, [preview]);

  useEffect(() => {
    const signature = receipt ? `${receipt.section}:${JSON.stringify(receipt.receipt)}` : null;
    if (signature && signature !== lastReceipt.current) receiptRef.current?.focus();
    lastReceipt.current = signature;
  }, [receipt]);

  const showRisk = section.section === 'operational' && props.riskItem !== null && props.mode === 'prod';

  return (
    <article className="setup-config" data-setup-section={section.section} data-setup-section-status={chip}>
      <div className="setup-config__head">
        <h3>{label}</h3>
        <span className="setup-step__badge" role="status" data-setup-chip={chip} data-setup-config-chip={chip}>{t(CHIP_LABEL[chip])}</span>
      </div>
      <p className="setup-config__meta">
        <span>{t('ui.setup.config.effective')}</span>
        {section.currentUnavailable
          ? <span className="field__hint" data-setup-config-unavailable={section.section}>{t('ui.setup.config.current_unavailable')}</span>
          : null}
      </p>
      {current.length > 0 ? (
        <dl className="setup__receipt" data-setup-config-current={section.section} data-setup-config-value={section.section}>
          {current.map((row) => (
            <div key={row.field}>
              <dt>{row.field}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : section.currentUnavailable ? null : (
        <p className="field__hint" data-setup-config-value={section.section}>{t('ui.setup.config.no_value')}</p>
      )}

      {section.section === 'agent' ? (
        <AgentProviderRecord t={t} linked={providerRecord(section, receipt)} />
      ) : null}

      {fields.length > 0 ? (
        <div className="setup-config__row" data-setup-config-form={section.section}>
          {orgError ? (
            <div className="form-alert" role="alert" id={formErrorId} data-setup-config-form-error={section.section}>
              {t(ORG_ERROR[orgError] ?? 'ui.setup.config.error.field_charset')}
            </div>
          ) : null}
          {fields.map((field) => (
            <div className="field" key={field.name}>
              <label htmlFor={inputId(field.name, field.kind)}>
                {t(`ui.setup.config.field.${field.name}`)}
              </label>
              {field.kind === 'select' ? (
                <select
                  id={inputId(field.name, field.kind)}
                  className="setup-config__select"
                  value={draft[field.name] ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft((value) => ({ ...value, [field.name]: event.target.value }));
                    if (preview) props.onDiscard(section.section);
                  }}
                >
                  <option value="">{t('ui.setup.config.choose')}</option>
                  {choices.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : field.kind === 'toggle' ? (
                <input
                  id={inputId(field.name, field.kind)}
                  type="checkbox"
                  checked={(draft[field.name] ?? 'true') !== 'false'}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft((value) => ({ ...value, [field.name]: String(event.target.checked) }));
                    if (preview) props.onDiscard(section.section);
                  }}
                />
              ) : (
                <input
                  id={inputId(field.name, field.kind)}
                  type="text"
                  value={draft[field.name] ?? ''}
                  maxLength={field.name === 'organizationName' ? 120 : 200}
                  required={field.name === 'organizationName' ? undefined : true}
                  aria-invalid={field.name === 'organizationName' && orgError ? true : undefined}
                  aria-describedby={field.name === 'organizationName' && orgError ? formErrorId : undefined}
                  placeholder={field.name === 'organizationName' ? t('ui.setup.config.field.organizationName_hint') : undefined}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft((value) => ({ ...value, [field.name]: event.target.value }));
                    if (preview) props.onDiscard(section.section);
                  }}
                />
              )}
            </div>
          ))}
          <button
            className="btn btn--secondary"
            type="button"
            data-setup-config-preview-submit={section.section}
            disabled={!canPreview}
            onClick={() => props.onPreview(section.section, values)}
          >
            {t('ui.setup.config.preview')}
          </button>
        </div>
      ) : null}

      {preview && section.section !== 'operational' ? (
        <div className="setup-config__diff" ref={previewRef} tabIndex={-1} aria-live="polite" data-setup-config-preview={section.section}>
          <h4>{t('ui.setup.config.preview_title')}</h4>
          {preview.changes.length > 0 ? (
            <dl className="setup__receipt">
              {preview.changes.map((change) => (
                <div key={change.field}>
                  <dt>{change.field}</dt>
                  <dd>{change.from ?? t('ui.setup.config.no_value')} → {change.to ?? t('ui.setup.config.no_value')}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="field__hint">{t('ui.setup.config.no_changes')}</p>}
          <div className="setup__ai-actions">
            <button
              className="btn btn--primary"
              type="button"
              data-setup-config-apply={section.section}
              disabled={preview.changes.length === 0 || busy}
              onClick={() => props.onApply(section.section, values)}
            >
              {t('ui.setup.config.apply')}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => props.onDiscard(section.section)}>
              {t('ui.setup.config.discard')}
            </button>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="form-note" ref={receiptRef} tabIndex={-1} data-setup-config-receipt={section.section}>
          <div>
            <h4>{t('ui.setup.config.receipt_title')}</h4>
            <p className="field__hint" data-setup-config-receipt-status={receipt.status}>{checkLabel(receipt.status, t)}</p>
            {readback.length > 0 ? (
              <dl className="setup__receipt">
                {readback.map((field) => (
                  <div key={field.field}>
                    <dt>{field.field}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
      ) : null}

      {section.section === 'operational' ? (
        <OperationalForms
          t={t}
          busy={busy}
          preview={preview}
          receipt={receipt}
          state={section.operational ?? receipt?.operational ?? null}
          onPreview={props.onPreview}
          onApply={props.onApply}
          onDeclare={props.onDeclare}
        />
      ) : null}

      {showRisk && props.riskItem ? (
        <div className="form-note" data-setup-config-risk={section.section}>
          <div>
            <h4>{t('ui.setup.config.risk_title')}</h4>
            <p className="field__hint">{t('ui.setup.config.risk_lead')}</p>
            <p className="field__hint" data-setup-config-risk-evidence={props.riskItem.id}>{props.riskItem.evidence}</p>
            <div className="field">
              <label htmlFor={`setup-config-risk-reason-${section.section}`}>{t('ui.setup.config.risk_reason')}</label>
              <input
                id={`setup-config-risk-reason-${section.section}`}
                type="text"
                value={riskReason}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setRiskReason(event.target.value)}
              />
            </div>
            <div className="setup-config__row">
              <label htmlFor={`setup-config-risk-confirm-${section.section}`}>
                <input
                  id={`setup-config-risk-confirm-${section.section}`}
                  type="checkbox"
                  checked={riskConfirmed}
                  disabled={busy}
                  onChange={(event) => setRiskConfirmed(event.target.checked)}
                />{' '}
                {t('ui.setup.config.risk_confirm')}
              </label>
              <button
                className="btn btn--secondary"
                type="button"
                data-setup-config-risk-accept={section.section}
                disabled={!riskConfirmed || busy}
                onClick={() => {
                  setRiskConfirmed(false);
                  props.onAcceptRisk(section.section, props.riskItem!.id, riskReason);
                }}
              >
                {t('ui.setup.config.risk_accept')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {section.postponable && chip !== 'postponed' ? (
        <div className="setup__ai-actions">
          <button
            className="btn btn--secondary"
            type="button"
            data-setup-config-postpone={section.section}
            disabled={busy}
            onClick={() => props.onPostpone(section.section)}
          >
            {t('ui.setup.config.postpone')}
          </button>
        </div>
      ) : null}

      {props.appUsable ? (
        <a className="setup-config__link" href={route} data-setup-config-link={section.section}>
          {t('ui.setup.config.open_settings')}
        </a>
      ) : <p className="field__hint">{t('ui.setup.config.settings_later')}</p>}
    </article>
  );
}

export interface VerifyPanelProps {
  t: Translator;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  checklist: Checklist | null;
  state: string;
  verifying: boolean;
  appUsable: boolean;
  onVerify: () => void;
  onBack: () => void;
}

export function VerifyPanel(props: VerifyPanelProps) {
  const { t, checklist } = props;
  return (
    <section className="setup__ai" aria-labelledby="setup-verify-title" data-setup-panel="verify" data-setup-state={props.state}>
      <h2 id="setup-verify-title" tabIndex={-1} ref={props.headingRef}>{t('ui.setup.verify.title')}</h2>
      <p className="setup__lead">{t('ui.setup.verify.lead')}</p>
      {checklist ? (
        <>
          <p className="setup__state">
            {t('ui.setup.verify.mode')} <span className="setup__state-value" data-setup-verify-mode>{checklist.mode ?? '—'}</span>
          </p>
          <ol className="setup-verify" data-setup-verify="checklist">
            {checklist.items.map((item) => (
              <li key={item.id} className="setup-verify__item" data-setup-verify-item={item.id} data-setup-verify-status={item.status}>
                <div className="setup-verify__head">
                  <h3>{checklistLabel(item.id, t)}</h3>
                  <span className="setup-step__badge" role="status" data-setup-chip={item.status}>{checkLabel(item.status, t)}</span>
                </div>
                {item.evidence ? (
                  <p className="field__hint" data-setup-verify-evidence={item.id}>{item.evidence}</p>
                ) : <p className="field__hint" data-setup-verify="no-evidence">{t('ui.setup.verify.no_evidence')}</p>}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="form-note" data-setup-verify="unknown">{t('ui.setup.verify.unknown')}</p>
      )}
      <div className="setup__ai-actions">
        <button className="btn btn--secondary" type="button" id="setup-verify-again" onClick={props.onVerify} disabled={props.verifying}>
          {props.verifying ? t('ui.setup.config.verifying') : t('ui.setup.verify.again')}
        </button>
        {!props.appUsable ? (
          <button className="btn btn--secondary" type="button" id="setup-verify-back" onClick={props.onBack}>
            {t('ui.setup.verify.back')}
          </button>
        ) : null}
      </div>
      <p className="field__hint">{t('ui.setup.verify.next')}</p>
      {props.appUsable ? <a className="setup-config__link" href={SECTION_ROUTES.operational}>{t('ui.setup.config.open_settings')}</a> : null}
    </section>
  );
}

export interface FinishPanelProps {
  t: Translator;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  errorRef?: RefObject<HTMLParagraphElement | null>;
  report: SetupReport | null;
  loading: boolean;
  error: CompletionCode | null;
  completing: boolean;
  completeError: CompletionCode | null;
  onDownload: () => void;
  onRetry: () => void;
  onConfirm: () => void;
}

/** One closed sentence per completion refusal; unknown codes are availability. */
function completionMessage(code: CompletionCode, t: Translator): string {
  switch (code) {
    case 'completion_blocked': return t('ui.setup.finish.error.completion_blocked');
    case 'session_expired': return t('ui.setup.finish.error.session_expired');
    case 'state_refused': return t('ui.setup.finish.error.state_refused');
    case 'network': return t('ui.setup.finish.error.network');
    case 'timeout': return t('ui.setup.finish.error.timeout');
    case 'invalid-response': return t('ui.setup.finish.error.invalid_response');
    case 'setup_complete': return t('ui.setup.complete.title');
    default: return t('ui.setup.finish.error.unavailable');
  }
}

function shown(value: string | boolean | null | undefined): string {
  if (typeof value === 'boolean') return value ? '✓' : '—';
  return value && String(value).trim() ? String(value) : '—';
}

/**
 * The last screen: the sanitized preview the service will export, an explicit
 * JSON download, and one confirmation. Nothing here reads a field the client's
 * allowlist did not keep, so an echoing service cannot put a credential on the
 * page.
 */
export function FinishPanel(props: FinishPanelProps) {
  const { t, report } = props;
  const passed = report ? report.checklist.filter((item) => item.status === 'passed').length : 0;
  const total = report ? report.checklist.length : 0;
  return (
    <section className="setup__ai" aria-labelledby="setup-finish-title" data-setup-finish data-setup-state={report?.state ?? ''}>
      <h2 id="setup-finish-title" tabIndex={-1} ref={props.headingRef}>{t('ui.setup.finish.title')}</h2>
      <p className="setup__lead">{t('ui.setup.finish.lead')}</p>
      <div className="setup__messages" aria-live="polite" aria-atomic="true" data-setup-finish-status>
        {props.loading ? <p className="form-note" role="status">{t('ui.setup.finish.report_loading')}</p> : null}
        {props.error ? (
          <p className="form-alert" role="alert" tabIndex={-1} ref={props.errorRef}>{completionMessage(props.error, t)}</p>
        ) : null}
        {props.completeError ? (
          <p className="form-alert" role="alert" tabIndex={-1} ref={props.errorRef} data-setup-finish-error>{completionMessage(props.completeError, t)}</p>
        ) : null}
      </div>
      {report ? (
        <section aria-labelledby="setup-finish-report-title" data-setup-finish-report>
          <h3 id="setup-finish-report-title">{t('ui.setup.finish.report_title')}</h3>
          <dl className="setup__receipt">
            <div>
              <dt>{t('ui.setup.finish.mode')}</dt>
              <dd data-setup-finish-field="mode">{shown(report.mode)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.owner')}</dt>
              <dd data-setup-finish-field="owner">{shown(report.owner.username)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.ai_status')}</dt>
              <dd data-setup-finish-field="ai-status">{shown(report.ai.status)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.ai_provider')}</dt>
              <dd data-setup-finish-field="ai-provider">{shown(report.ai.provider)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.ai_model')}</dt>
              <dd data-setup-finish-field="ai-model">{shown(report.ai.model)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.storage_engine')}</dt>
              <dd data-setup-finish-field="storage-engine">{shown(report.storage.engine)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.storage_status')}</dt>
              <dd data-setup-finish-field="storage-status">{shown(report.storage.status)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.checks')}</dt>
              <dd data-setup-finish-field="checks">{t('ui.setup.finish.checks_value', { passed, total })}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.verified_at')}</dt>
              <dd data-setup-finish-field="verified-at">{shown(report.verifiedAt)}</dd>
            </div>
            <div>
              <dt>{t('ui.setup.finish.instance')}</dt>
              <dd data-setup-finish-field="instance">{shown(report.instanceId)}</dd>
            </div>
            {report.reportDigest ? (
              <div>
                <dt>{t('ui.setup.finish.digest')}</dt>
                <dd data-setup-finish-field="digest"><code>{report.reportDigest}</code></dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      <div className="setup__ai-actions">
        <button className="btn btn--secondary" type="button" id="setup-finish-download" onClick={props.onDownload} disabled={!report}>
          {t('ui.setup.finish.download')}
        </button>
        <button className="btn btn--secondary" type="button" id="setup-finish-report-retry" onClick={props.onRetry} disabled={props.loading}>
          {props.loading ? t('ui.setup.finish.report_loading') : t('ui.setup.finish.report_retry')}
        </button>
        <button
          className="btn btn--primary"
          type="button"
          id="setup-finish-confirm"
          onClick={props.onConfirm}
          disabled={props.completing || report === null}
        >
          {props.completing ? t('ui.setup.finish.confirming') : t('ui.setup.finish.confirm')}
        </button>
      </div>
      <p className="field__hint">{t('ui.setup.finish.confirm_hint')}</p>
    </section>
  );
}
