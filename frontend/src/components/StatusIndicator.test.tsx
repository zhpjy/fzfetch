import React from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusIndicator } from './StatusIndicator';
import { renderWithI18n } from '../test/renderWithI18n';

describe('StatusIndicator', () => {
  it('shows English labels when locale is en', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="connecting" indexStatus="unknown" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    const desktop = screen.getByTestId('status-indicator-desktop');
    expect(within(desktop).getByText('Connecting')).toBeInTheDocument();
    expect(within(desktop).getByText('IDLE')).toBeInTheDocument();
  });

  it('shows Chinese labels when locale is zh-CN', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="refreshing" workStatus="refreshing" />,
      { initialLocale: 'zh-CN' },
    );

    const desktop = screen.getByTestId('status-indicator-desktop');
    expect(within(desktop).getByText('索引后台更新中')).toBeInTheDocument();
    expect(within(desktop).getByText('扫描中')).toBeInTheDocument();
  });

  it('shows localized disconnected label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="disconnected" indexStatus="unknown" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(within(screen.getByTestId('status-indicator-desktop')).getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows localized error label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="error" indexStatus="unknown" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(within(screen.getByTestId('status-indicator-desktop')).getByText('Connection error')).toBeInTheDocument();
  });

  it('shows localized pending index label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="pending" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(within(screen.getByTestId('status-indicator-desktop')).getByText('Index pending')).toBeInTheDocument();
  });

  it('shows localized ready index label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="ready" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(within(screen.getByTestId('status-indicator-desktop')).getByText('Index ready')).toBeInTheDocument();
  });

  it('renders work status before index status', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="ready" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    const desktop = screen.getByTestId('status-indicator-desktop');
    const workLabel = within(desktop).getByText('IDLE');
    const indexLabel = within(desktop).getByText('Index ready');

    expect(workLabel.compareDocumentPosition(indexLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps legacy props compatible while labels are translated', () => {
    renderWithI18n(
      <StatusIndicator status="ready" isSearching={true} />,
      { initialLocale: 'en' },
    );

    expect(within(screen.getByTestId('status-indicator-desktop')).getByText('SEARCHING')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
  });

  it('maps legacy refreshing status to localized refreshing labels', () => {
    renderWithI18n(
      <StatusIndicator status="refreshing" isSearching={false} />,
      { initialLocale: 'zh-CN' },
    );

    const desktop = screen.getByTestId('status-indicator-desktop');
    expect(within(desktop).getByText('索引后台更新中')).toBeInTheDocument();
    expect(within(desktop).getByText('扫描中')).toBeInTheDocument();
  });

  it('maps legacy disconnected status to localized disconnected label', () => {
    renderWithI18n(
      <StatusIndicator status="disconnected" isSearching={false} />,
      { initialLocale: 'zh-CN' },
    );

    expect(within(screen.getByTestId('status-indicator-desktop')).getByText('未连接服务器')).toBeInTheDocument();
  });

  it('renders compact mobile summary and desktop full labels with responsive wrappers', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="ready" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    const mobile = screen.getByTestId('status-indicator-mobile');
    const desktop = screen.getByTestId('status-indicator-desktop');

    expect(mobile.className).toContain('sm:hidden');
    expect(desktop.className).toContain('hidden');
    expect(desktop.className).toContain('sm:flex');

    expect(within(mobile).getByText('Index ready')).toBeInTheDocument();
    expect(within(mobile).queryByText('IDLE')).not.toBeInTheDocument();

    expect(within(desktop).getByText('Index ready')).toBeInTheDocument();
    expect(within(desktop).getByText('IDLE')).toBeInTheDocument();
  });

  it('prefers connection status over index status in mobile summary', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="disconnected" indexStatus="refreshing" workStatus="refreshing" />,
      { initialLocale: 'en' },
    );

    const mobile = screen.getByTestId('status-indicator-mobile');
    expect(within(mobile).getByText('Disconnected')).toBeInTheDocument();
    expect(within(mobile).queryByText('Index refreshing')).not.toBeInTheDocument();
  });

  it('shows dot instead of spinner when disconnected takes precedence over refreshing index on mobile', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="disconnected" indexStatus="refreshing" workStatus="refreshing" />,
      { initialLocale: 'en' },
    );

    const mobile = screen.getByTestId('status-indicator-mobile');
    expect(within(mobile).getByText('Disconnected')).toBeInTheDocument();
    expect(mobile.querySelector('svg.lucide-loader-circle')).toBeNull();
    expect(mobile.querySelector('span.h-2.w-2.rounded-full')).not.toBeNull();
  });

  it('uses localized primary status for mobile aria label', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="pending" workStatus="idle" />,
      { initialLocale: 'zh-CN' },
    );

    const mobile = screen.getByTestId('status-indicator-mobile');
    expect(within(mobile).getByText('索引待初始化')).toBeInTheDocument();
    expect(mobile).toHaveAttribute('role', 'status');
    expect(mobile).toHaveAttribute('aria-label', '索引待初始化');
  });
});
