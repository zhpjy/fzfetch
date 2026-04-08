import { useState, useEffect, useCallback } from 'react';
import { SearchHit } from '../types';

export function useKeyboardNavigation(
  results: SearchHit[],
  onDownload: (item: SearchHit) => void,
  onEscape?: () => void
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keep selection within bounds when results change (including item removal).
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (results.length === 0) return 0;
      return Math.min(prev, results.length - 1);
    });
  }, [results.length]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        if (results.length === 0) return;
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % results.length);
        break;
      case 'ArrowUp':
        if (results.length === 0) return;
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        break;
      case 'Enter':
        e.preventDefault();
        {
          const item = results[selectedIndex];
          if (item) onDownload(item);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onEscape?.();
        break;
    }
  }, [results, selectedIndex, onDownload, onEscape]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    const el = document.getElementById(`item-${selectedIndex}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  return { selectedIndex, setSelectedIndex };
}
