import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Header from '../components/Header';

describe('header flavor badge placement', () => {
  it('Header はタイトルを従来どおり表示し、flavor badge を表示しない', () => {
    render(
      <Header
        onOpenSettings={vi.fn()}
        onOpenProjectManager={vi.fn()}
        onOpenAppHelp={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'タートルビデオ' })).toBeInTheDocument();
    expect(screen.queryByText('標準モード')).not.toBeInTheDocument();
    expect(screen.queryByText('Apple Safari 動作モード')).not.toBeInTheDocument();
    expect(screen.queryByText('Safari動作')).not.toBeInTheDocument();
  });
});