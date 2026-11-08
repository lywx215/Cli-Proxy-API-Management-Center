import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { EnterpriseWebCredentialDialog } from '@/features/authFiles/enterpriseWeb/EnterpriseWebCredentialDialog';
import iconGemini from '@/assets/icons/gemini.svg';
import { ProviderTile } from './ProviderTile';

type Props = { index: number; onCredentialAdded: () => void };

export function GeminiEnterpriseWebImport({ index, onCredentialAdded }: Props) {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [apiBase, managementKey, connected]);
  return (
    <>
      <ProviderTile
        label={t('enterprise_web.title')}
        caption={t('enterprise_web.login_method')}
        icon={iconGemini}
        index={index}
        onOpen={() => {
          setOpen(true);
        }}
      />
      {open && (
        <EnterpriseWebCredentialDialog
          editing={null}
          onClose={() => setOpen(false)}
          onSaved={() => {
            notifyAuthFilesChanged();
            onCredentialAdded();
            showNotification(t('enterprise_web.credential_saved'), 'success');
          }}
        />
      )}
    </>
  );
}
