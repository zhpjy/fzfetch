import { useState, useEffect, useCallback } from 'react';
import { SearchHit } from '../types';

export function useKeyboardNavigation(
  results: SearchHit[],
  onDownload: (item: SearchHit) => void
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % results.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
        break;
      case 'Enter':
        e.preventDefault();
        onDownload(results[selectedIndex]);
        break;
      case 'Escape':
        // Optional: Handled by search query reset in some cases
        break;
    }
  }, [results, selectedIndex, onDownload]);

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
