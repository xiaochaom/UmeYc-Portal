import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

import { Settings } from './settings';
import { useGlobalState } from '../hooks/global-state';
import { Position, ViewMode } from '../lib/util';
import { rememberUrl, rememberPageTitle } from '../lib/url-history';

vi.mock('../hooks/global-state', () => ({
  useGlobalState: vi.fn(),
}));

vi.mock('./url-modal', () => ({
  UrlModalWithState: () => <div>URL Modal</div>,
}));

vi.mock('@decky/ui', () => ({
  Field: ({ children, label }: { children: ReactNode; label: string }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  DialogButton: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  PanelSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  PanelSectionRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ButtonItem: ({
    label,
    children,
    onClick,
  }: {
    label?: string;
    children?: ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{label ?? children}</button>,
  ToggleField: ({
    label,
    checked,
    disabled,
    description,
    onChange,
  }: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    description?: string;
    onChange: (val: boolean) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {description && <span data-testid="toggle-description">{description}</span>}
    </label>
  ),
  showModal: vi.fn(),
}));

const createState = (viewMode: ViewMode) => ({
  viewMode,
  previousViewMode: ViewMode.Picture,
  visible: true,
  position: Position.TopRight,
  margin: 30,
  size: 1,
  url: 'https://netflix.com',
  controlBar: true,
});

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it.each([
    ViewMode.Picture,
    ViewMode.Expand,
    ViewMode.Minimised,
    ViewMode.Closed,
    ViewMode.Sidebar,
  ])('preserves the reader switch when opening settings in mode %s', (mode) => {
    let state = createState(mode);
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
      {},
    ] as never);
    render(<Settings />);
    expect(state.viewMode).toBe(mode);
    expect(state.visible).toBe(true);
    for (const label of ['布局', '展开', '控制栏', '位置', '大小', '边距']) {
      expect(screen.queryByLabelText(label)).toBeNull();
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('offers optional sidebar space control for websites only', () => {
    let state = {
      ...createState(ViewMode.Sidebar),
      sidebarVideoSpace: false,
      rightStickFullscreen: false,
    };
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (f: (s: typeof state) => typeof state) => {
        state = f(state);
      },
      {},
    ] as never);
    const { rerender } = render(<Settings />);
    fireEvent.click(screen.getByLabelText('随侧栏播放/暂停'));
    expect(state.sidebarVideoSpace).toBe(true);
    fireEvent.click(screen.getByLabelText('按下右摇杆切换视频全屏'));
    expect(state.rightStickFullscreen).toBe(true);
    vi.mocked(useGlobalState).mockReturnValue([
      { ...state, url: 'file:///tmp/guide.JPG' },
      vi.fn(),
      {},
    ] as never);
    rerender(<Settings />);
    expect(screen.queryByLabelText('随侧栏播放/暂停')).toBeNull();
    expect(screen.queryByLabelText('按下右摇杆切换视频全屏')).toBeNull();
  });

  it.each([
    ['本地文件', 'files'],
    ['使用说明', 'help'],
  ])('opens %s', (label, panel) => {
    vi.mocked(useGlobalState).mockReturnValue([
      createState(ViewMode.Sidebar),
      vi.fn(),
      {},
    ] as never);
    render(<Settings />);
    fireEvent.click(screen.getByText(label));
    const setter = vi.mocked(vi.mocked(useGlobalState).mock.results.slice(-1)[0].value[1]);
    expect(setter).toHaveBeenLastCalledWith(expect.any(Function));
    const update = setter.mock.calls.slice(-1)[0][0];
    expect(update(createState(ViewMode.Sidebar)).activePanel).toBe(panel);
  });

  it('can reopen a closed reader in sidebar mode', () => {
    let state = createState(ViewMode.Closed);
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
      {},
    ] as never);
    render(<Settings />);
    expect(state.viewMode).toBe(ViewMode.Closed);
    fireEvent.click(screen.getByText('打开'));
    expect(state.viewMode).toBe(ViewMode.Sidebar);
  });

  it('keeps a closed reader closed when leaving and reopening settings', () => {
    let state = createState(ViewMode.Closed);
    const setter = (updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    };
    vi.mocked(useGlobalState).mockReturnValue([state, setter, {}] as never);
    const { unmount } = render(<Settings />);
    unmount();
    render(<Settings />);
    expect(state.viewMode).toBe(ViewMode.Closed);
    expect(screen.getByText('打开')).toBeTruthy();
  });

  it('handles address modal and close in sidebar mode', () => {
    let state = createState(ViewMode.Picture);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, { marker: true }] as never);

    render(<Settings />);

    fireEvent.click(screen.getByRole('button', { name: '编辑网页' }));
    expect((state as typeof state & { activePanel: string }).activePanel).toBe('url');

    fireEvent.click(screen.getByText('关闭'));
    expect(state.viewMode).toBe(ViewMode.Closed);
    expect((state as typeof state & { activePanel?: string }).activePanel).toBeUndefined();
  });

  it.each(['url', 'phone', 'files'] as const)(
    'closes the active %s panel together with the reader and reopens only the current page',
    (activePanel) => {
      let state = {
        ...createState(ViewMode.Sidebar),
        activePanel: activePanel as string | undefined,
      };
      const setState = (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      };
      vi.mocked(useGlobalState).mockReturnValue([state, setState, {}] as never);
      const { rerender } = render(<Settings />);
      fireEvent.click(screen.getByText('关闭'));
      expect(state.viewMode).toBe(ViewMode.Closed);
      expect(state.activePanel).toBeUndefined();
      expect(state.url).toBe('https://netflix.com');
      vi.mocked(useGlobalState).mockReturnValue([state, setState, {}] as never);
      rerender(<Settings />);
      fireEvent.click(screen.getByText('打开'));
      expect(state.viewMode).toBe(ViewMode.Sidebar);
      expect(state.activePanel).toBeUndefined();
    },
  );

  it('keeps the webpage title as the unified entry and QR on its own row', () => {
    const state = {
      ...createState(ViewMode.Sidebar),
      url: 'https://example.com/' + 'guide/'.repeat(50),
    };
    vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), { marker: true }] as never);
    rememberUrl(localStorage, state.url);
    rememberPageTitle(localStorage, state.url, '很长的网页标题'.repeat(20));
    render(<Settings />);
    const edit = screen.getByRole('button', { name: '编辑网页' });
    expect(screen.getByText('网页')).toBeTruthy();
    expect(edit).toHaveTextContent('很长的网页标题');
    expect(edit).not.toHaveTextContent(state.url);
    expect(screen.queryByText('网址')).toBeNull();
    expect(edit.querySelector('span')).toHaveStyle({
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });
    const qr = screen.getByRole('button', { name: '扫码传送' });
    expect(qr.textContent).toBe('扫码传送');
    expect(qr.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button', { name: '历史记录' })).toBeNull();
    expect(qr.parentElement).not.toBe(edit.parentElement);
    expect(edit).toHaveStyle({ width: '100%' });
    expect(edit.contains(qr)).toBe(false);
    fireEvent.click(qr);
    const setter = vi.mocked(vi.mocked(useGlobalState).mock.results.slice(-1)[0].value[1]);
    expect(setter.mock.calls.slice(-1)[0][0](state).activePanel).toBe('phone');
    expect(state.url).toBe('https://example.com/' + 'guide/'.repeat(50));
  });

  it('shows the Chinese local filename and opens the unified page panel', () => {
    const state = {
      ...createState(ViewMode.Sidebar),
      url: 'file:///run/media/deck/SD/%E4%B8%AD%E6%96%87%E6%94%BB%E7%95%A5.JPG',
    };
    vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), {}] as never);
    render(<Settings />);
    expect(screen.getByRole('button', { name: '编辑网页' })).toHaveTextContent('中文攻略.JPG');
    expect(screen.queryByText(state.url)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑网页' }));
    const setter = vi.mocked(vi.mocked(useGlobalState).mock.results.slice(-1)[0].value[1]);
    expect(setter.mock.calls.slice(-1)[0][0](state).activePanel).toBe('url');
  });
});
