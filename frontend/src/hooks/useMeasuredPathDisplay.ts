import { useLayoutEffect, useRef, useState } from 'react';

import { fitPathToWidth, middleEllipsisPath } from '../pathDisplay';

function toCanvasFont(style: CSSStyleDeclaration) {
  if (style.font) {
    return style.font;
  }

  const fallback = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontSize,
    style.fontFamily,
  ]
    .filter(Boolean)
    .join(' ');

  return fallback || '10px sans-serif';
}

export function useMeasuredPathDisplay() {
  const probeRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [font, setFont] = useState('');

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) {
      return;
    }

    const updateMetrics = (width: number) => {
      setAvailableWidth(width);
      setFont(toCanvasFont(window.getComputedStyle(probe)));
    };

    updateMetrics(probe.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateMetrics(entry.contentRect.width);
    });

    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  const measureText = (value: string) => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    const context = canvasRef.current.getContext('2d');
    if (!context) {
      return value.length;
    }

    context.font = font;
    return context.measureText(value).width;
  };

  const getDisplayedPath = (path: string, isSelected: boolean) => {
    if (isSelected) {
      return path;
    }

    if (availableWidth <= 0 || !font) {
      return middleEllipsisPath(path, 42);
    }

    return fitPathToWidth(path, availableWidth, measureText);
  };

  return {
    probeRef,
    getDisplayedPath,
  };
}
