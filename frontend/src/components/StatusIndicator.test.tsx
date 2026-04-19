import React from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusIndicator } from './StatusIndicator';
import { renderWithI18n } from '../test/renderWithI18n';

describe('StatusIndicator', () => {
  it('shows English labels when locale is en', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="connecting" indexStatus="unknown" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(screen.getByText('Connecting')).toBeInTheDocument();
    expect(screen.getByText('IDLE')).toBeInTheDocument();
  });

  it('shows Chinese labels when locale is zh-CN', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="refreshing" workStatus="refreshing" />,
      { initialLocale: 'zh-CN' },
    );

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.getByText('扫描中')).toBeInTheDocument();
  });

  it('shows localized disconnected label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="disconnected" indexStatus="unknown" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows localized error label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="error" indexStatus="unknown" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(screen.getByText('Connection error')).toBeInTheDocument();
  });

  it('shows localized pending index label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="pending" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(screen.getByText('Index pending')).toBeInTheDocument();
  });

  it('shows localized ready index label for modern props', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="ready" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    expect(screen.getByText('Index ready')).toBeInTheDocument();
  });

  it('renders work status before index status', () => {
    renderWithI18n(
      <StatusIndicator connectionStatus="ready" indexStatus="ready" workStatus="idle" />,
      { initialLocale: 'en' },
    );

    const workLabel = screen.getByText('IDLE');
    const indexLabel = screen.getByText('Index ready');

    expect(workLabel.compareDocumentPosition(indexLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps legacy props compatible while labels are translated', () => {
    renderWithI18n(
      <StatusIndicator status="ready" isSearching={true} />,
      { initialLocale: 'en' },
    );

    expect(screen.getByText('SEARCHING')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
  });

  it('maps legacy refreshing status to localized refreshing labels', () => {
    renderWithI18n(
      <StatusIndicator status="refreshing" isSearching={false} />,
      { initialLocale: 'zh-CN' },
    );

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.getByText('扫描中')).toBeInTheDocument();
  });

  it('maps legacy disconnected status to localized disconnected label', () => {
    renderWithI18n(
      <StatusIndicator status="disconnected" isSearching={false} />,
      { initialLocale: 'zh-CN' },
    );

    expect(screen.getByText('未连接服务器')).toBeInTheDocument();
  });
});
