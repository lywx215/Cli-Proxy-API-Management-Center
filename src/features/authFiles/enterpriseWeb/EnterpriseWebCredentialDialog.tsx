import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { getStatusFromError } from '@/utils/quota';
import {
  enterpriseWebApi,
  getEnterpriseWebEditError,
  parseEnterpriseWebPage,
  type EnterpriseWebEdit,
} from '@/services/api/geminiEnterpriseWeb';
import type { AuthFileItem } from '@/types';
import { EnterpriseWebCredentialStatus } from './EnterpriseWebCredentialStatus';
import { useEnterpriseWebRuntime } from './useEnterpriseWebRuntime';
import styles from './EnterpriseWebCredentialDialog.module.scss';

const createEdit = (editing: AuthFileItem | null): EnterpriseWebEdit => ({
  name: editing?.name,
  expectedRevision: editing?.geminiEnterpriseWeb?.revision,
  label: typeof editing?.label === 'string' ? editing.label : '',
  cookies: '',
  pageUrl: editing?.geminiEnterpriseWeb?.pageUrl ?? '',
  userAgent: editing?.geminiEnterpriseWeb?.userAgent ?? '',
  proxyUrl: editing?.geminiEnterpriseWeb?.proxyUrl ?? '',
  priority: editing?.priority ?? 0,
  modelPolicy: editing?.geminiEnterpriseWeb?.modelPolicy ?? 'unclassified',
});

type Props = {
  editing: AuthFileItem | null;
  onClose: () => void;
  onSaved: () => Promise<unknown> | void;
};

export function EnterpriseWebCredentialDialog({ editing, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const runtime = useEnterpriseWebRuntime();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const initialConnection = useRef({ apiBase, managementKey, connected });
  const [edit, setEdit] = useState(() => createEdit(editing));
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [summary, setSummary] = useState(editing?.geminiEnterpriseWeb);
  const credentialPending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const initial = initialConnection.current;
    if (
      initial.apiBase !== apiBase ||
      initial.managementKey !== managementKey ||
      initial.connected !== connected
    ) {
      generation.current++;
      setEdit(createEdit(null));
      setFormError('');
      onClose();
    }
  }, [apiBase, managementKey, connected, onClose]);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const saveCredential = async () => {
    if (credentialPending.current || revisionConflict) return;
    const validation = getEnterpriseWebEditError(edit);
    if (validation) {
      setFormError(t(`enterprise_web.${validation}`));
      return;
    }
    credentialPending.current = true;
    setCredentialSaving(true);
    setFormError('');
    const current = generation.current;
    const revision = apiClient.getConnectionRevision();
    try {
      await enterpriseWebApi.saveCredential({
        ...edit,
        cookies: edit.cookies?.trim() || undefined,
        // Older servers omitted this safe field from summaries. Preserve the
        // stored value when an unchanged blank input cannot represent it.
        userAgent:
          editing && editing.geminiEnterpriseWeb?.userAgent === undefined && !edit.userAgent
            ? undefined
            : edit.userAgent,
      });
      if (current !== generation.current || revision !== apiClient.getConnectionRevision()) return;
      setEdit(createEdit(null));
      onClose();
      await onSaved();
    } catch (failure) {
      if (current !== generation.current || revision !== apiClient.getConnectionRevision()) return;
      if (edit.name && getStatusFromError(failure) === 409) {
        setRevisionConflict(true);
        setFormError(t('enterprise_web.credential_revision_conflict'));
      } else {
        setFormError(failure instanceof Error ? failure.message : t('enterprise_web.save_failed'));
      }
    } finally {
      if (current === generation.current) {
        credentialPending.current = false;
        setCredentialSaving(false);
      }
    }
  };
  const reloadRevision = async () => {
    if (credentialPending.current || !edit.name) return;
    const name = edit.name;
    const authIndex = editing?.authIndex;
    const current = generation.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      current === generation.current && revision === apiClient.getConnectionRevision();
    credentialPending.current = true;
    setCredentialSaving(true);
    try {
      const { files } = await authFilesApi.list({
        name,
        authIndex: authIndex == null ? undefined : String(authIndex),
      });
      if (!isCurrent()) return;
      const latest = files.find(
        (file) =>
          file.name === name && (authIndex == null || String(file.authIndex) === String(authIndex))
      )?.geminiEnterpriseWeb;
      if (!latest?.revision) throw new Error('revision_unavailable');
      setSummary(latest);
      setEdit((prior) => ({ ...prior, expectedRevision: latest.revision }));
      setRevisionConflict(false);
      setFormError('');
    } catch {
      if (isCurrent()) setFormError(t('enterprise_web.credential_revision_reload_failed'));
    } finally {
      if (current === generation.current) {
        credentialPending.current = false;
        setCredentialSaving(false);
      }
    }
  };
  const patchEdit = (patch: Partial<EnterpriseWebEdit>) =>
    setEdit((prior) => ({ ...prior, ...patch }));
  const page = parseEnterpriseWebPage(edit.pageUrl);
  const pageError = getEnterpriseWebEditError({
    ...edit,
    cookies: undefined,
    name: edit.name ?? '__page_preview__',
    priority: 0,
  });
  return (
    <Modal
      open={true}
      onClose={onClose}
      closeDisabled={credentialSaving}
      title={t(edit.name ? 'enterprise_web.edit_cookie' : 'enterprise_web.add_cookie')}
      width={760}
      footer={
        <Button
          onClick={() => void saveCredential()}
          disabled={
            credentialSaving ||
            revisionConflict ||
            !connected ||
            runtime.unsupported ||
            !runtime.status
          }
          loading={credentialSaving}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className={styles.editor}>
        <p>{t('enterprise_web.credential_scope')}</p>
        {summary && <EnterpriseWebCredentialStatus summary={summary} />}
        {runtime.unsupported && <p role="alert">{t('enterprise_web.unsupported')}</p>}
        {runtime.error && <p role="alert">{t('enterprise_web.unknown')}</p>}
        <Input
          label={t('enterprise_web.name')}
          value={edit.label}
          maxLength={160}
          disabled={credentialSaving}
          onChange={(event) => patchEdit({ label: event.target.value })}
        />
        <Input
          label={t('enterprise_web.page_url')}
          value={edit.pageUrl}
          disabled={credentialSaving}
          onChange={(event) => patchEdit({ pageUrl: event.target.value })}
        />
        <div className="form-group">
          <label id="enterprise-web-policy-label">{t('enterprise_web.model_policy')}</label>
          <Select
            value={edit.modelPolicy}
            options={[
              { value: 'unclassified', label: t('enterprise_web.policy_select') },
              { value: 'argon_only', label: t('enterprise_web.policy_argon_only') },
              { value: 'exclude_argon', label: t('enterprise_web.policy_exclude_argon') },
            ]}
            onChange={(value) =>
              patchEdit({ modelPolicy: value as EnterpriseWebEdit['modelPolicy'] })
            }
            ariaLabelledBy="enterprise-web-policy-label"
            disabled={credentialSaving}
            fullWidth
          />
          <p className="hint">{t('enterprise_web.policy_hint')}</p>
          {editing && !editing.geminiEnterpriseWeb?.modelPolicySupported && (
            <p role="alert">{t('enterprise_web.policy_unsupported')}</p>
          )}
        </div>
        {edit.pageUrl && (
          <div className={styles.preview}>
            {page
              ? `region: ${page.location} · configId: ${page.configId} · authuser: ${page.authUser}`
              : t(`enterprise_web.${pageError ?? 'invalid_url'}`)}
          </div>
        )}
        <Input
          label={t('enterprise_web.cookies')}
          type="password"
          autoComplete="new-password"
          value={edit.cookies ?? ''}
          disabled={credentialSaving}
          maxLength={40000}
          placeholder={
            edit.name ? t('enterprise_web.cookie_keep') : 'SID=…; SAPISID=…; __Secure-1PSID=…'
          }
          hint={t('enterprise_web.cookie_hint')}
          onChange={(event) => patchEdit({ cookies: event.target.value })}
        />
        <p className="hint">{t('enterprise_web.policy_cookie_hint')}</p>
        <div className={styles.fields}>
          <Input
            label="User-Agent"
            value={edit.userAgent}
            disabled={credentialSaving}
            onChange={(event) => patchEdit({ userAgent: event.target.value })}
          />
          <Input
            label={t('enterprise_web.proxy')}
            value={edit.proxyUrl}
            disabled={credentialSaving}
            onChange={(event) => patchEdit({ proxyUrl: event.target.value })}
          />
          <Input
            label={t('enterprise_web.priority')}
            type="number"
            value={edit.priority}
            disabled={credentialSaving}
            onChange={(event) => patchEdit({ priority: Number(event.target.value) })}
          />
        </div>
        <p className="hint">{t('enterprise_web.alias_hint')}</p>
        {formError && (
          <div className={styles.error} role="alert">
            {formError}
          </div>
        )}
        {revisionConflict && (
          <Button
            variant="secondary"
            onClick={() => void reloadRevision()}
            disabled={credentialSaving || !connected}
          >
            {t('enterprise_web.credential_revision_reload')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
