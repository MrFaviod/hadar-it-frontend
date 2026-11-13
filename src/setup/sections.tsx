// Configuration and verification panels for the first-start wizard.
//
// The wizard shows what each section holds right now, where that value comes
// from, and what a change would do before it does it. A value set by the
// deployment environment is read-only here: the panel explains where it lives
// instead of pretending the wizard owns it. Applying always takes a second,
// explicit confirm; the receipt is the service's read-back, not the request.

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type {
  AiDiagnosticCode,
  Checklist,
  ChecklistItem,
  ConfigurationDiagnosticCode,
  SectionApplyReceipt,
  SectionId,
  SectionPreview,
  SectionView,
} from './client';
import { SECTION_ROUTES, chipFor, isLocked, suggestionsFor, type SectionChip } from './section-status';
import type { Translator } from './strings';
import '../../assets/css/setup.css';

const CHIP_LABEL: Record<SectionChip, string> = {
  pending: 'ui.setup.config.chip.pending',
  postponed: 'ui.setup.config.chip.postponed',
  applied: 'ui.setup.config.chip.applied',
  verified: 'ui.setup.config.chip.verified',
  risk: 'ui.setup.config.chip.risk',
};

const SOURCE_LABEL: Record<string, string> = {
  default: 'ui.setup.config.source.default',
  installation: 'ui.setup.config.source.installation',
  environment: 'ui.setup.config.source.environment',
  domain_service: 'ui.setup.config.source.domain_service',
  unknown: 'ui.setup.config.source.unknown',
};

const CHECK_LABEL: Record<string, string> = {
  passed: 'ui.setup.verify.status.passed',
  failed: 'ui.setup.verify.status.failed',
  pending: 'ui.setup.verify.status.pending',
  postponed: 'ui.setup.verify.status.postponed',
  risk: 'ui.setup.verify.status.risk',
};

/** Checklist ids the contract defines; anything else is shown as data. */
const KNOWN_ITEMS = new Set([
  'database_ready', 'migrated', 'worker_ready', 'storage_ready', 'origin_valid',
  'session_valid', 'ai_explicit', 'appearance_decided', 'backup_policy_declared',
  'smtp', 'monitoring', 'external_search', 'external_engines', 'integrations',
]);

const CONFIG_ERROR: Record<ConfigurationDiagnosticCode, string> = {
  confirm_required: 'ui.setup.config.error.confirm_required',
  state_refused: 'ui.setup.config.error.state_refused',
  item_required: 'ui.setup.config.error.item_required',
  not_postponable: 'ui.setup.config.error.not_postponable',
  invalid_request: 'ui.setup.config.error.invalid_request',
  session_expired: 'ui.setup.config.error.session_expired',
  unavailable: 'ui.setup.config.error.unavailable',
  network: 'ui.setup.config.error.network',
  timeout: 'ui.setup.config.error.timeout',
  'invalid-response': 'ui.setup.config.error.invalid_response',
};

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
  sections: SectionView[];
  loading: boolean;
  error: ConfigurationDiagnosticCode | null;
  busy: SectionId | null;
  previews: Partial<Record<SectionId, SectionPreview>>;
  receipts: Partial<Record<SectionId, SectionApplyReceipt>>;
  blocked: ChecklistItem[] | null;
  aiDeferred: boolean;
  appUsable: boolean;
  verifying: boolean;
  verifyError: ConfigurationDiagnosticCode | null;
  assistant: AssistantView;
  onPreview: (section: SectionId, value: string) => void;
  onApply: (section: SectionId, value: string) => void;
  onDiscard: (section: SectionId) => void;
  onPostpone: (section: SectionId) => void;
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
          key={section.id}
          t={t}
          section={section}
          chip={chipFor(section, { aiDeferred: props.aiDeferred })}
          preview={props.previews[section.id] ?? null}
          receipt={props.receipts[section.id] ?? null}
          busy={props.busy === section.id}
          appUsable={appUsable}
          onPreview={props.onPreview}
          onApply={props.onApply}
          onDiscard={props.onDiscard}
          onPostpone={props.onPostpone}
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
                    onClick={() => props.onPreview(suggestion.section, suggestion.value)}
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
  section: SectionView;
  chip: SectionChip;
  preview: SectionPreview | null;
  receipt: SectionApplyReceipt | null;
  busy: boolean;
  appUsable: boolean;
  onPreview: (section: SectionId, value: string) => void;
  onApply: (section: SectionId, value: string) => void;
  onDiscard: (section: SectionId) => void;
  onPostpone: (section: SectionId) => void;
}

function SectionCard(props: SectionCardProps) {
  const { t, section, chip, preview, receipt, busy } = props;
  const [draft, setDraft] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const lastPreview = useRef<string | null>(null);
  const lastReceipt = useRef<string | null>(null);
  const locked = isLocked(section);
  const label = t(`ui.setup.config.section.${section.id}`);
  const route = SECTION_ROUTES[section.id];

  // Focus follows the result, not the click: a preview and an apply receipt
  // arrive from the service asynchronously, and each is the next thing to read.
  useEffect(() => {
    const signature = preview ? `${preview.section}:${preview.value ?? ''}` : null;
    if (signature && signature !== lastPreview.current) previewRef.current?.focus();
    lastPreview.current = signature;
  }, [preview]);

  useEffect(() => {
    const signature = receipt ? `${receipt.section}:${receipt.readback.map((field) => `${field.field}=${field.value}`).join('|')}` : null;
    if (signature && signature !== lastReceipt.current) receiptRef.current?.focus();
    lastReceipt.current = signature;
  }, [receipt]);

  const changes = preview?.changes ?? [];
  const canApply = preview !== null && preview.changes.length > 0 && !busy;

  return (
    <article className="setup-config" data-setup-section={section.id} data-setup-section-status={chip}>
      <div className="setup-config__head">
        <h3>{label}</h3>
        <span className="setup-step__badge" role="status" data-setup-chip={chip} data-setup-config-chip={chip}>{t(CHIP_LABEL[chip])}</span>
      </div>
      <p className="setup-config__meta">
        <span>{t('ui.setup.config.effective')}</span>
        <code data-setup-config-value={section.id}>{section.value ?? t('ui.setup.config.no_value')}</code>
        <span data-setup-config-source={section.source}>{t(SOURCE_LABEL[section.source] ?? SOURCE_LABEL.unknown)}</span>
      </p>
      {locked ? <p className="field__hint" data-setup-config-locked>{t('ui.setup.config.locked')}</p> : null}

      {!locked && section.options.length > 0 ? (
        <div className="setup-config__row">
          <div className="field">
            <label htmlFor={`setup-config-input-${section.id}`}>{t('ui.setup.config.change')}</label>
            <select
              id={`setup-config-input-${section.id}`}
              className="setup-config__select"
              value={draft}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value);
                if (preview) props.onDiscard(section.id);
              }}
            >
              <option value="">{t('ui.setup.config.choose')}</option>
              {section.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <button
            className="btn btn--secondary"
            type="button"
            data-setup-config-preview-submit={section.id}
            disabled={!draft || busy}
            onClick={() => props.onPreview(section.id, draft)}
          >
            {t('ui.setup.config.preview')}
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="setup-config__diff" ref={previewRef} tabIndex={-1} aria-live="polite" data-setup-config-preview={section.id}>
          <h4>{t('ui.setup.config.preview_title')}</h4>
          {changes.length > 0 ? (
            <dl className="setup__receipt">
              {changes.map((change) => (
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
              data-setup-config-apply={section.id}
              disabled={!canApply}
              onClick={() => props.onApply(section.id, preview.value ?? draft)}
            >
              {t('ui.setup.config.apply')}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => props.onDiscard(section.id)}>
              {t('ui.setup.config.discard')}
            </button>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="form-note" ref={receiptRef} tabIndex={-1} data-setup-config-receipt={section.id}>
          <div>
            <h4>{t('ui.setup.config.receipt_title')}</h4>
            <dl className="setup__receipt">
              {receipt.readback.map((field) => (
                <div key={field.field}>
                  <dt>{field.field}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}

      {section.postponable && chip !== 'postponed' ? (
        <div className="setup__ai-actions">
          <button
            className="btn btn--secondary"
            type="button"
            data-setup-config-postpone={section.id}
            disabled={busy}
            onClick={() => props.onPostpone(section.id)}
          >
            {t('ui.setup.config.postpone')}
          </button>
        </div>
      ) : null}

      {props.appUsable ? (
        <a className="setup-config__link" href={route} data-setup-config-link={section.id}>
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
                {item.evidence.length > 0 ? (
                  <dl className="setup__receipt" data-setup-verify-evidence={item.id}>
                    {item.evidence.map((field) => (
                      <div key={field.field}>
                        <dt>{field.field}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
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
