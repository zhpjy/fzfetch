import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusIndicator } from './StatusIndicator';

describe('StatusIndicator', () => {
  it('shows "索引后台更新中" for indexing and does not render a refresh button (new props)', () => {
    render(<StatusIndicator connectionStatus="connected" workStatus="indexing" />);

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });

  it('shows "未连接服务器" for disconnected (new props)', () => {
    render(<StatusIndicator connectionStatus="disconnected" workStatus="idle" />);

    expect(screen.getByText('未连接服务器')).toBeInTheDocument();
  });

  it('is compatible with legacy props and still does not render a refresh button', () => {
    render(
      <StatusIndicator
        status="refreshing"
        isSearching={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });
});

