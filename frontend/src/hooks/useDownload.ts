import { useState } from 'react';
import { SearchHit } from '../types';

export function useDownload(onGhostFound: (path: string) => void) {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDownload = async (item: SearchHit) => {
    if (downloadingPath) return;
    setDownloadingPath(item.path);

    try {
      const response = await fetch(`/download?path=${encodeURIComponent(item.path)}`);

      if (response.status === 410) {
        showToast('410 Gone: 文件已被移动或删除', 'error');
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
      a.href = url;
      a.download = item.path.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      showToast(`已开始下载: ${item.path.split('/').pop()}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('下载失败', 'error');
    } finally {
      setDownloadingPath(null);
    }
  };

  return { handleDownload, downloadingPath, toast, setToast };
}
