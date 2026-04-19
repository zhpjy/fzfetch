import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useI18n } from './useI18n';
import { LOCALE_STORAGE_KEY } from './types';
import { renderWithI18n } from '../test/renderWithI18n';

function setBrowserLanguage(language: string) {
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: language,
  });
}

function Probe() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div>
      <div data-testid="locale">{locale}</div>
      <div data-testid="search-placeholder">{t('search.placeholder')}</div>
      <div data-testid="toast-download-started">{t('toast.downloadStarted', { name: 'demo.txt' })}</div>
      <button onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')} type="button">
        switch
      </button>
    </div>
  );
}

describe('I18nProvider locale resolution', () => {
  afterEach(() => {
    localStorage.clear();
    setBrowserLanguage('en-US');
    document.title = '';
    vi.restoreAllMocks();
  });

  it('resolves zh browser language to zh-CN', () => {
    setBrowserLanguage('zh-TW');
    renderWithI18n(<Probe />);

    expect(screen.getByTestId('locale')).toHaveTextContent('zh-CN');
    expect(screen.getByTestId('search-placeholder')).toHaveTextContent('输入关键词进行实时模糊搜索...');
    expect(screen.getByTestId('toast-download-started')).toHaveTextContent('已开始下载: demo.txt');
    expect(document.title).toBe('Fzfetch - 本地文件极速模糊搜索');
  });

  it('resolves non-zh browser language to en', () => {
    setBrowserLanguage('fr-FR');
    renderWithI18n(<Probe />);

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('search-placeholder')).toHaveTextContent('Type to fuzzy search files...');
    expect(screen.getByTestId('toast-download-started')).toHaveTextContent('Started download: demo.txt');
    expect(document.title).toBe('Fzfetch - Ultra High Performance Search');
  });

  it('uses saved localStorage locale over browser language', () => {
    setBrowserLanguage('en-US');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');

    renderWithI18n(<Probe />);

    expect(screen.getByTestId('locale')).toHaveTextContent('zh-CN');
    expect(screen.getByTestId('search-placeholder')).toHaveTextContent('输入关键词进行实时模糊搜索...');
  });

  it('persists manual locale changes to localStorage', () => {
    setBrowserLanguage('zh-CN');
    renderWithI18n(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'switch' }));

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.title).toBe('Fzfetch - Ultra High Performance Search');
  });

  it('supports interpolation for toast.downloadStarted', () => {
    setBrowserLanguage('en-US');
    renderWithI18n(<Probe />);

    expect(screen.getByTestId('toast-download-started')).toHaveTextContent('Started download: demo.txt');
  });

  it('falls back to browser locale when reading localStorage throws', () => {
    setBrowserLanguage('zh-TW');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    renderWithI18n(<Probe />);

    expect(screen.getByTestId('locale')).toHaveTextContent('zh-CN');
  });

  it('does not crash when persisting localStorage throws', () => {
    setBrowserLanguage('zh-CN');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    renderWithI18n(<Probe />);

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'switch' }))).not.toThrow();
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
  });
});
