import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode, ComponentProps } from 'react';

import { UrlModal } from './url-modal';
import { useGlobalState } from '../hooks/global-state';
import { Position, ViewMode } from '../lib/util';

vi.mock('../hooks/global-state', () => ({
  useGlobalState: vi.fn(),
}));

vi.mock('@decky/ui', () => ({
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
  Focusable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextField: ({ value, onChange }: { value: string; onChange: (e: unknown) => void }) => (
    <input aria-label="url" value={value} onChange={onChange} />
  ),
}));

vi.mock('./native-dialog', () => ({
  NativeDialog: ({
    children,
    onOK,
    onCancel,
  }: {
    children: ReactNode;
    onOK: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <button onClick={onOK}>OK</button>
      <button onClick={onCancel}>Cancel</button>
      {children}
    </div>
  ),
}));

const createState = () => ({
  viewMode: ViewMode.Picture,
  visible: true,
  position: Position.TopRight,
  margin: 30,
  size: 1,
  url: 'https://netflix.com',
  controlBar: true,
});

describe('UrlModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides on mount and restores visibility on unmount', () => {
    let state = { ...createState(), viewMode: ViewMode.Closed };
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState] as never);

    const { unmount } = render(<UrlModal closeModal={() => {}} />);

    expect(state.visible).toBe(false);

    unmount();

    expect(state.visible).toBe(true);
  });

  it('opens the selected url even when the reader was closed', () => {
    let state = { ...createState(), viewMode: ViewMode.Closed };
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState] as never);

    render(<UrlModal closeModal={() => {}} />);

    fireEvent.change(screen.getByLabelText('url'), { target: { value: 'https://youtube.com' } });
    fireEvent.click(screen.getByText('OK'));

    expect(state.url).toBe('https://youtube.com');
    expect(state.visible).toBe(true);
    expect(state.viewMode).toBe(ViewMode.Sidebar);
  });

  it('does not cause infinite loop from unstable setGlobalState reference', () => {
    let state = createState();
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState] as never);

    render(<UrlModal closeModal={() => {}} />);

    // Should be called exactly once on mount (visible: false), not repeatedly
    expect(setGlobalState).toHaveBeenCalledTimes(1);
    expect(state.visible).toBe(false);
  });

  it('restores visibility when cancelled', () => {
    let state = { ...createState(), viewMode: ViewMode.Closed };
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState] as never);

    render(<UrlModal closeModal={() => {}} />);
    fireEvent.click(screen.getByText('Cancel'));

    expect(state.visible).toBe(true);
    expect(state.url).toBe('https://netflix.com');
    expect(state.viewMode).toBe(ViewMode.Closed);
  });
});
