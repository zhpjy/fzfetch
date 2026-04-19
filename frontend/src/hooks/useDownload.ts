import { useEffect, useRef, useState } from 'react';
import { SearchHit } from '../types';
import { useI18n } from '../i18n/useI18n';

export function useDownload(onGhostFound: (path: string) => void) {
  const { t } = useI18n();
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, []);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    if (!mountedRef.current) return;
    setToast({ msg, type });
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3000);
  };

  const handleDownload = async (item: SearchHit) => {
    // Synchronous guard against double-trigger/reentrancy (keyboard repeat / double click).
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (mountedRef.current) setDownloadingPath(item.path);

    try {
      const response = await fetch(`/download?path=${encodeURIComponent(item.path)}`);

      if (response.status === 410) {
        // 410 means the file is already gone; treat it as a soft hint and trigger cleanup.
        showToast(t('toast.fileGone'), 'success');
        onGhostFound(item.path);
        return;
      }

      if (!response.ok) {
        throw new Error('Download failed');
      }

      // Start the download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileName = item.path.split('/').pop() || 'download';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showToast(t('toast.downloadStarted', { name: fileName }), 'success');
    } catch (err) {
      console.error(err);
      if (mountedRef.current) showToast(t('toast.downloadFailed'), 'error');
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setDownloadingPath(null);
    }
  };

  return { handleDownload, downloadingPath, toast, setToast };
}
