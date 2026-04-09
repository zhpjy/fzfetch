import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusIndicator } from './StatusIndicator';

describe('StatusIndicator', () => {
  it('shows "索引后台更新中" for refreshing and does not render a refresh button (new props)', () => {
    render(<StatusIndicator connectionStatus="ready" indexStatus="refreshing" workStatus="refreshing" />);

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });

  it('shows "正在连接" for connecting (new props)', () => {
    render(<StatusIndicator connectionStatus="connecting" indexStatus="unknown" workStatus="idle" />);

    expect(screen.getByText('正在连接')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });

  it('shows "未连接服务器" for disconnected (new props)', () => {
    render(<StatusIndicator connectionStatus="disconnected" indexStatus="unknown" workStatus="idle" />);

    expect(screen.getByText('未连接服务器')).toBeInTheDocument();
  });

  it('shows "连接异常" for error (new props)', () => {
    render(<StatusIndicator connectionStatus="error" indexStatus="unknown" workStatus="idle" />);

    expect(screen.getByText('连接异常')).toBeInTheDocument();
  });

  it('shows "索引待初始化" when backend reports pending', () => {
    render(<StatusIndicator connectionStatus="ready" indexStatus="pending" workStatus="idle" />);

    expect(screen.getByText('索引待初始化')).toBeInTheDocument();
  });

  it('shows "索引就绪" only when backend reports ready', () => {
    render(<StatusIndicator connectionStatus="ready" indexStatus="ready" workStatus="idle" />);

    expect(screen.getByText('索引就绪')).toBeInTheDocument();
  });

  it('is compatible with legacy props and does not require onRefresh', () => {
    render(
      <StatusIndicator
        status="refreshing"
        isSearching={false}
      />,
    );

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });

  it('legacy isSearching affects work label (SEARCHING)', () => {
    render(<StatusIndicator status="ready" isSearching={true} />);

    expect(screen.getByText('SEARCHING')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });
});
