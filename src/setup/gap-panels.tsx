// The operational section's two editors and the agent section's provider
// record line.
//
// A declaration is not an apply: it records a stated policy as ``declared``,
// so its own button says "declare" and the receipt repeats the service's word.
// The origin/session apply writes the installation file and reports which
// values the environment overrides and that a restart is needed — the page
// repeats those facts instead of implying the values are live.

import { useRef, useState, type FormEvent } from 'react';
import type { OperationalState, SectionDecision, SectionInput, SectionPreview } from './client';
import {
  BACKUP_LOCATION_KINDS,
  backupDeclarationValues,
  emptyBackupDeclaration,
  emptyOriginSettings,
  effectiveRows,
  isBackupDeclarationPreview,
  isOriginSettingsPreview,
  originSettingsValues,
  restartScopeKeys,
  validateBackupDeclaration,
  validateOriginSettings,
  type BackupDeclarationState,
  type BackupField,
  type OriginField,
  type OriginSettingsState,
} from './gap-forms';
import type { Translator } from './strings';

function ValueDiff({ t, preview }: { t: Translator; preview: SectionPreview }) {
  if (preview.changes.length === 0) return <p className="field__hint">{t('ui.setup.config.no_changes')}</p>;
  return (
    <dl className="setup__receipt">
      {preview.changes.map((change) => (
        <div key={change.field}>
          <dt>{change.field}</dt>
          <dd>{change.from ?? t('ui.setup.config.no_value')} → {change.to ?? t('ui.setup.config.no_value')}</dd>
        </div>
      ))}
    </dl>
  );
}

function backupMessage(field: BackupField, state: BackupDeclarationState, t: Translator): string {
  const value = field === 'location_kind' ? state.locationKind : state[field];
  if (!value.trim()) return t('ui.setup.config.error.field_required');
  if (field === 'retention' && !/[0-9]/.test(value)) return t('ui.setup.config.error.retention_number');
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return t('ui.setup.config.error.field_control');
  return t('ui.setup.config.error.field_too_long');
}

function originMessage(field: OriginField, state: OriginSettingsState, t: Translator): string {
  const value = field === 'auth_origin' ? state.origin : field === 'auth_cookie_name' ? state.cookieName : state.sessionMinutes;
  if (!value.trim()) return t('ui.setup.config.error.field_required');
  if (field === 'auth_origin') return t('ui.setup.config.error.origin');
  if (field === 'auth_cookie_name') return t('ui.setup.config.error.cookie_name');
  return t('ui.setup.config.error.session_minutes');
}

interface FormProps {
  t: Translator;
  busy: boolean;
  preview: SectionPreview | null;
  receipt: SectionDecision | null;
  state: OperationalState | null;
  onPreview: (section: 'operational', values: SectionInput) => void;
  onApply: (section: 'operational', values: SectionInput) => void;
  onDeclare: (section: 'operational', values: SectionInput) => void;
}

function BackupDeclarationForm(props: FormProps) {
  const { t, busy, preview, receipt } = props;
  const [draft, setDraft] = useState<BackupDeclarationState>(emptyBackupDeclaration);
  const [error, setError] = useState<BackupField | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const declaring = isBackupDeclarationPreview(preview);
  const readback = props.state?.backupPolicy ?? null;

  const set = (field: keyof BackupDeclarationState, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const problem = validateBackupDeclaration(draft);
    setError(problem);
    if (problem) {
      errorRef.current?.focus();
      return;
    }
    props.onPreview('operational', backupDeclarationValues(draft));
  }

  const id = (field: string) => `setup-backup-${field}`;
  const describedBy = error ? 'setup-backup-target-hint setup-backup-error' : 'setup-backup-target-hint';

  return (
    <form className="setup-config__form" onSubmit={submit} noValidate data-setup-backup-form>
      <h4>{t('ui.setup.config.backup.title')}</h4>
      <p className="field__hint" id="setup-backup-target-hint">{t('ui.setup.config.backup.lead')}</p>
      {error ? (
        <div className="form-alert" role="alert" tabIndex={-1} ref={errorRef} id="setup-backup-error" data-setup-gap-error="backup">
          {backupMessage(error, draft, t)}
        </div>
      ) : null}
      <div className="setup-config__row">
        <div className="field">
          <label htmlFor={id('target')}>{t('ui.setup.config.field.target')}</label>
          <input
            id={id('target')}
            type="text"
            value={draft.target}
            maxLength={200}
            required
            aria-invalid={error === 'target' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('target', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id('location_kind')}>{t('ui.setup.config.field.location_kind')}</label>
          <select
            id={id('location_kind')}
            className="setup-config__select"
            value={draft.locationKind}
            required
            aria-invalid={error === 'location_kind' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('locationKind', event.target.value)}
          >
            <option value="">{t('ui.setup.config.choose')}</option>
            {BACKUP_LOCATION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </div>
      </div>
      <div className="setup-config__row">
        <div className="field">
          <label htmlFor={id('schedule')}>{t('ui.setup.config.field.schedule')}</label>
          <input
            id={id('schedule')}
            type="text"
            value={draft.schedule}
            maxLength={120}
            required
            aria-invalid={error === 'schedule' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('schedule', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id('retention')}>{t('ui.setup.config.field.retention')}</label>
          <input
            id={id('retention')}
            type="text"
            value={draft.retention}
            maxLength={120}
            required
            aria-invalid={error === 'retention' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('retention', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id('responsible')}>{t('ui.setup.config.field.responsible')}</label>
          <input
            id={id('responsible')}
            type="text"
            value={draft.responsible}
            maxLength={120}
            required
            aria-invalid={error === 'responsible' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('responsible', event.target.value)}
          />
        </div>
      </div>
      <div className="setup__ai-actions">
        <button className="btn btn--secondary" type="submit" data-setup-backup-preview disabled={busy}>
          {t('ui.setup.config.preview')}
        </button>
      </div>

      {preview && declaring ? (
        <div className="setup-config__diff" aria-live="polite" data-setup-backup-diff>
          <h4>{t('ui.setup.config.preview_title')}</h4>
          <ValueDiff t={t} preview={preview} />
          <div className="setup__ai-actions">
            <button
              className="btn btn--primary"
              type="button"
              data-setup-backup-declare
              disabled={busy}
              onClick={() => props.onDeclare('operational', backupDeclarationValues(draft))}
            >
              {t('ui.setup.config.backup.declare')}
            </button>
          </div>
        </div>
      ) : null}

      {readback ? (
        <div className="form-note" data-setup-backup-readback>
          <h4>{t('ui.setup.config.backup.current_title')}</h4>
          <dl className="setup__receipt">
            <div><dt>{t('ui.setup.config.field.target')}</dt><dd>{readback.target ?? t('ui.setup.config.no_value')}</dd></div>
            <div><dt>{t('ui.setup.config.field.location_kind')}</dt><dd>{readback.locationKind ?? t('ui.setup.config.no_value')}</dd></div>
            <div><dt>{t('ui.setup.config.field.schedule')}</dt><dd>{readback.schedule ?? t('ui.setup.config.no_value')}</dd></div>
            <div><dt>{t('ui.setup.config.field.retention')}</dt><dd>{readback.retention ?? t('ui.setup.config.no_value')}</dd></div>
            <div><dt>{t('ui.setup.config.field.responsible')}</dt><dd>{readback.responsible ?? t('ui.setup.config.no_value')}</dd></div>
          </dl>
        </div>
      ) : null}

      {receipt?.operational?.backupPolicy ? (
        <p className="field__hint" data-setup-backup-receipt>
          {t('ui.setup.config.backup.receipt', {
            by: receipt.operational.backupPolicy.declaredBy ?? t('ui.setup.config.no_value'),
          })}
        </p>
      ) : null}
    </form>
  );
}

function OriginSettingsForm(props: FormProps) {
  const { t, busy, preview } = props;
  const [draft, setDraft] = useState<OriginSettingsState>(emptyOriginSettings);
  const [error, setError] = useState<OriginField | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const applying = isOriginSettingsPreview(preview);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const problem = validateOriginSettings(draft);
    setError(problem);
    if (problem) {
      errorRef.current?.focus();
      return;
    }
    props.onPreview('operational', originSettingsValues(draft));
  }

  const set = (field: keyof OriginSettingsState, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const id = (field: string) => `setup-origin-${field}`;
  const describedBy = error ? 'setup-origin-auth_origin-hint setup-origin-error' : 'setup-origin-auth_origin-hint';

  return (
    <form className="setup-config__form" onSubmit={submit} noValidate data-setup-origin-form>
      <h4>{t('ui.setup.config.origin.title')}</h4>
      <p className="field__hint" id="setup-origin-auth_origin-hint">{t('ui.setup.config.origin.lead')}</p>
      {error ? (
        <div className="form-alert" role="alert" tabIndex={-1} ref={errorRef} id="setup-origin-error" data-setup-gap-error="origin">
          {originMessage(error, draft, t)}
        </div>
      ) : null}
      <div className="setup-config__row">
        <div className="field">
          <label htmlFor={id('auth_origin')}>{t('ui.setup.config.field.auth_origin')}</label>
          <input
            id={id('auth_origin')}
            type="text"
            value={draft.origin}
            maxLength={200}
            aria-invalid={error === 'auth_origin' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('origin', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id('auth_cookie_name')}>{t('ui.setup.config.field.auth_cookie_name')}</label>
          <input
            id={id('auth_cookie_name')}
            type="text"
            value={draft.cookieName}
            maxLength={120}
            aria-invalid={error === 'auth_cookie_name' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('cookieName', event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id('auth_session_minutes_default')}>{t('ui.setup.config.field.auth_session_minutes_default')}</label>
          <input
            id={id('auth_session_minutes_default')}
            type="text"
            inputMode="numeric"
            value={draft.sessionMinutes}
            maxLength={6}
            aria-invalid={error === 'auth_session_minutes_default' ? true : undefined}
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(event) => set('sessionMinutes', event.target.value)}
          />
        </div>
      </div>
      <div className="setup-config__row">
        <label htmlFor={id('auth_cookie_secure')}>
          <input
            id={id('auth_cookie_secure')}
            type="checkbox"
            checked={draft.cookieSecure !== 'false'}
            disabled={busy}
            onChange={(event) => set('cookieSecure', String(event.target.checked))}
          />{' '}
          {t('ui.setup.config.field.auth_cookie_secure')}
        </label>
      </div>
      <div className="setup__ai-actions">
        <button className="btn btn--secondary" type="submit" data-setup-origin-preview disabled={busy}>
          {t('ui.setup.config.preview')}
        </button>
      </div>

      {preview && applying ? (
        <div className="setup-config__diff" aria-live="polite" data-setup-origin-diff>
          <h4>{t('ui.setup.config.preview_title')}</h4>
          <ValueDiff t={t} preview={preview} />
          <div className="setup__ai-actions">
            <button
              className="btn btn--primary"
              type="button"
              data-setup-origin-apply
              disabled={busy}
              onClick={() => props.onApply('operational', originSettingsValues(draft))}
            >
              {t('ui.setup.config.apply')}
            </button>
          </div>
        </div>
      ) : null}

      <EffectiveSettings t={t} state={props.state} />
      <RestartNotice t={t} state={props.state} />
    </form>
  );
}

function EffectiveSettings({ t, state }: { t: Translator; state: OperationalState | null }) {
  const rows = effectiveRows(state);
  if (rows.length === 0) return null;
  return (
    <div className="form-note" data-setup-effective>
      <h4>{t('ui.setup.config.effective_title')}</h4>
      <dl className="setup__receipt">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{fieldLabel(row.key, t)}</dt>
            <dd data-setup-effective-key={row.key}>
              {row.value}
              {' '}
              <span className="field__hint" data-setup-effective-source={row.source ?? 'unknown'}>
                {t(sourceKey(row.source))}
              </span>
              {row.overriddenBy ? (
                <span className="field__hint" data-setup-effective-override={row.overriddenBy}>
                  {' · '}{t('ui.setup.config.effective_overridden', { env: row.overriddenBy })}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const FIELD_LABELS = new Set([
  'auth_origin',
  'auth_cookie_secure',
  'auth_cookie_name',
  'auth_session_minutes_default',
]);

/** The section's own label for a setting, or the service's key when unknown. */
function fieldLabel(key: string, t: Translator): string {
  return FIELD_LABELS.has(key) ? t(`ui.setup.config.field.${key}`) : key;
}

function sourceKey(source: string | null): string {
  if (source === 'env') return 'ui.setup.config.source.environment';
  if (source === 'installation') return 'ui.setup.config.source.installation';
  if (source === 'default') return 'ui.setup.config.source.default';
  return 'ui.setup.config.source.unknown';
}

function RestartNotice({ t, state }: { t: Translator; state: OperationalState | null }) {
  const scope = restartScopeKeys(state);
  if (scope.length === 0) return null;
  const names = scope.map((unit) => t(`ui.setup.config.restart.${unit}`)).join(', ');
  return (
    <div className="form-note" role="note" data-setup-restart>
      <h4>{t('ui.setup.config.restart.title')}</h4>
      <p data-setup-restart-notice>{t('ui.setup.config.restart.notice', { scope: names })}</p>
      <p className="field__hint">{t('ui.setup.config.restart.hint')}</p>
    </div>
  );
}

export interface OperationalFormsProps extends Omit<FormProps, 'onPreview' | 'onApply' | 'onDeclare'> {
  onPreview: (section: 'operational', values: SectionInput) => void;
  onApply: (section: 'operational', values: SectionInput) => void;
  onDeclare: (section: 'operational', values: SectionInput) => void;
}

export function OperationalForms(props: OperationalFormsProps) {
  const { t, busy, preview, receipt, state } = props;
  return (
    <div className="setup-config__forms" data-setup-operational-forms>
      <BackupDeclarationForm
        t={t}
        busy={busy}
        preview={preview}
        receipt={receipt}
        state={state}
        onPreview={props.onPreview}
        onApply={props.onApply}
        onDeclare={props.onDeclare}
      />
      <OriginSettingsForm
        t={t}
        busy={busy}
        preview={preview}
        receipt={receipt}
        state={state}
        onPreview={props.onPreview}
        onApply={props.onApply}
        onDeclare={props.onDeclare}
      />
    </div>
  );
}

/** The agent section's one line: is the selection backed by a global record? */
export function AgentProviderRecord({ t, linked }: { t: Translator; linked: boolean | null }) {
  const message = linked === true
    ? t('ui.setup.config.agent.provider_record_yes')
    : linked === false
      ? t('ui.setup.config.agent.provider_record_no')
      : t('ui.setup.config.agent.provider_record_unknown');
  return (
    <div className="form-note" data-setup-provider-record={linked === null ? 'unknown' : String(linked)}>
      <h4>{t('ui.setup.config.agent.provider_record_title')}</h4>
      <p data-setup-provider-record-line>{message}</p>
      <p className="field__hint">{t('ui.setup.config.agent.provider_record_help')}</p>
    </div>
  );
}
