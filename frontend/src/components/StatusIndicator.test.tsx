import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusIndicator } from './StatusIndicator';

describe('StatusIndicator', () => {
  it('shows "索引后台更新中" for refreshing and does not render a refresh button (new props)', () => {
    render(<StatusIndicator connectionStatus="ready" workStatus="refreshing" />);

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/ })).toBeNull();
  });

  it('shows "未连接服务器" for error (new props)', () => {
    render(<StatusIndicator connectionStatus="error" workStatus="ready" />);

    expect(screen.getByText('未连接服务器')).toBeInTheDocument();
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
});
