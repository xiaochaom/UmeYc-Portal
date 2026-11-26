import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { UrlModal } from './url-modal';
import { useGlobalState } from '../hooks/global-state';
import { prepareLocalFileMock } from '../__mocks__/decky-api';
import {
  rememberUrl,
  rememberPageTitle,
  getUrlHistory,
  URL_HISTORY_TITLES_KEY,
} from '../lib/url-history';
import { toLocalFileUrl } from '../lib/local-files';

vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  TextField: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: ComponentProps<'input'>['onChange'];
  }) => <input aria-label="url" value={value} onChange={onChange} />,
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
  Focusable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./native-dialog', () => ({
  NativeDialog: ({ children, onCancel }: { children: ReactNode; onCancel: () => void }) => (
    <div>
      <button onClick={onCancel}>关闭</button>
      {children}
    </div>
  ),
}));

describe('history in the unified webpage panel', () => {
  let state: { url: string; visible: boolean };
  beforeEach(() => {
    state = { url: 'https://current.example/', visible: true };
    prepareLocalFileMock.mockReset().mockResolvedValue({ url: 'http://127.0.0.1/viewer/test' });
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
    ] as never);
  });

  it('shows empty history and restores the page on close', () => {
    const close = vi.fn();
    const { unmount } = render(<UrlModal closeModal={close} />);
    expect(screen.getByText('还没有浏览记录。')).toBeTruthy();
    expect(state.visible).toBe(false);
    fireEvent.click(screen.getByText('关闭'));
    expect(close).toHaveBeenCalledOnce();
    unmount();
    expect(state.visible).toBe(true);
  });

  it('opens a recent website', async () => {
    rememberUrl(localStorage, 'https://recent.example/');
    rememberPageTitle(localStorage, 'https://recent.example/', '攻略网页标题');
    const close = vi.fn();
    const { unmount } = render(<UrlModal closeModal={close} />);
    expect(screen.getByText('攻略网页标题')).toBeTruthy();
    expect(screen.queryByText('https://recent.example/')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '打开历史记录 1' })));
    expect(state.url).toBe('https://recent.example/');
    expect(close).toHaveBeenCalledOnce();
    unmount();
  });

  it('shows a Chinese filename and validates the file before opening', async () => {
    const path = '/run/media/deck/SD/第一章攻略.JPG';
    rememberUrl(localStorage, toLocalFileUrl(path));
    const close = vi.fn();
    const { unmount } = render(<UrlModal closeModal={close} />);
    expect(screen.getByText('第一章攻略.JPG')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '打开历史记录 1' })));
    expect(prepareLocalFileMock).toHaveBeenCalledWith(path);
    expect(state.url).toBe(toLocalFileUrl(path));
    expect(close).toHaveBeenCalledOnce();
    unmount();
  });

  it('keeps the current page when the SD card file is missing', async () => {
    rememberUrl(localStorage, '/run/media/deck/SD/攻略.JPG');
    prepareLocalFileMock.mockRejectedValueOnce(new Error('请插入 SD 卡'));
    const { unmount } = render(<UrlModal closeModal={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '打开历史记录 1' })));
    expect(screen.getByRole('alert')).toHaveTextContent('请插入 SD 卡');
    expect(state.url).toBe('https://current.example/');
    unmount();
  });

  it('ignores a file selection that finishes after cancellation', async () => {
    rememberUrl(localStorage, '/run/media/deck/SD/攻略.JPG');
    let resolve!: (value: unknown) => void;
    prepareLocalFileMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { unmount } = render(<UrlModal closeModal={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开历史记录 1' }));
    unmount();
    await act(async () => {
      resolve({ url: 'http://127.0.0.1/viewer/test' });
    });
    expect(state.url).toBe('https://current.example/');
  });

  it('deletes only the selected history and title, without navigating or closing', () => {
    rememberUrl(localStorage, 'https://first.example/');
    rememberPageTitle(localStorage, 'https://first.example/', '第一条');
    rememberUrl(localStorage, '/tmp/中文图片.JPG');
    const close = vi.fn();
    render(<UrlModal closeModal={close} />);
    fireEvent.click(screen.getByRole('button', { name: '删除历史记录 2' }));
    expect(screen.queryByText('第一条')).toBeNull();
    expect(getUrlHistory(localStorage)).toEqual([
      'file:///tmp/%E4%B8%AD%E6%96%87%E5%9B%BE%E7%89%87.JPG',
    ]);
    expect(localStorage.getItem(URL_HISTORY_TITLES_KEY)).not.toContain('first.example');
    expect(close).not.toHaveBeenCalled();
    expect(state.url).toBe('https://current.example/');
    fireEvent.click(screen.getByRole('button', { name: '删除历史记录 1' }));
    expect(screen.getByText('还没有浏览记录。')).toBeTruthy();
    expect(prepareLocalFileMock).not.toHaveBeenCalled();
  });
});
