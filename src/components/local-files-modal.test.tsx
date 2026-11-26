import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { LocalFilesModal } from './local-files-modal';
import { useGlobalState } from '../hooks/global-state';
import {
  deleteLocalFileMock,
  listLocalFilesMock,
  getUploadDirectoryMock,
  prepareLocalFileMock,
} from '../__mocks__/decky-api';
import { getUrlHistory, rememberUrl } from '../lib/url-history';
import { toLocalFileUrl } from '../lib/local-files';
import { ViewMode } from '../lib/util';

vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
  Focusable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./native-dialog', () => ({
  NativeDialog: ({
    children,
    onOK,
    onCancel,
    strOKButtonText,
    bAlertDialog,
  }: {
    children: ReactNode;
    onOK: () => void;
    onCancel: () => void;
    strOKButtonText: string;
    bAlertDialog: boolean;
  }) => (
    <div>
      <button onClick={onOK}>{strOKButtonText}</button>
      {!bAlertDialog && <button onClick={onCancel}>取消</button>}
      {children}
    </div>
  ),
}));

vi.mock('./folder-picker', () => ({
  FolderPicker: ({ onChoose }: { onChoose(path: string): void }) => (
    <button onClick={() => onChoose('/home/deck/Pictures')}>use folder</button>
  ),
}));

const path = '/run/media/deck/SD/攻略/第一章.JPG';
const listing = {
  directory: '/run/media/deck/SD/攻略',
  parent: '/run/media/deck/SD',
  entries: [
    { name: '第一章.JPG', path, directory: false, delete_token: 'grant' },
    { name: '第二章', path: '/run/media/deck/SD/攻略/第二章', directory: true, delete_token: null },
  ],
  truncated: false,
};

describe('local file management', () => {
  let state: { url: string; visible: boolean; viewMode: ViewMode };
  beforeEach(() => {
    vi.clearAllMocks();
    state = { url: toLocalFileUrl(path), visible: true, viewMode: ViewMode.Sidebar };
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (update: (s: typeof state) => typeof state) => {
        state = update(state);
      },
    ] as never);
    listLocalFilesMock.mockReset().mockResolvedValue(listing);
    getUploadDirectoryMock.mockReset().mockResolvedValue({ directory: listing.directory });
    deleteLocalFileMock.mockReset().mockResolvedValue({ path });
    prepareLocalFileMock.mockReset().mockResolvedValue({ url: 'http://127.0.0.1/viewer/test' });
  });

  it('opens a Chinese SD-card image after validation and restores visibility', async () => {
    const close = vi.fn();
    const { unmount } = render(<LocalFilesModal closeModal={close} />);
    expect(state.visible).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: '打开文件 第一章.JPG' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(prepareLocalFileMock).toHaveBeenCalledWith(path);
    expect(state.url).toBe(toLocalFileUrl(path));
    expect(state.visible).toBe(true);
    expect(localStorage.getItem('portal.localDirectory')).toBe(listing.directory);
    unmount();
  });

  it('requires confirmation to delete and clears the matching history and current reader', async () => {
    rememberUrl(localStorage, 'https://keep.example/');
    rememberUrl(localStorage, path);
    const close = vi.fn();
    render(<LocalFilesModal closeModal={close} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除文件 第一章.JPG' }));
    expect(deleteLocalFileMock).not.toHaveBeenCalled();
    expect(screen.getByText(/删除后无法恢复/)).toBeTruthy();
    fireEvent.click(screen.getByText('取消'));
    expect(deleteLocalFileMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除文件 第一章.JPG' }));
    fireEvent.click(screen.getByRole('button', { name: /^删除文件$/ }));
    await waitFor(() => expect(listLocalFilesMock).toHaveBeenCalledTimes(2));
    expect(deleteLocalFileMock).toHaveBeenCalledExactlyOnceWith('grant');
    expect(getUrlHistory(localStorage)).toEqual(['https://keep.example/']);
    expect(state.url).toBe('');
    expect(state.viewMode).toBe(ViewMode.Closed);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps the page and history when opening or deleting fails', async () => {
    rememberUrl(localStorage, path);
    prepareLocalFileMock.mockRejectedValueOnce(new Error('文件不存在'));
    deleteLocalFileMock.mockRejectedValueOnce(new Error('文件已变化'));
    render(<LocalFilesModal closeModal={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '打开文件 第一章.JPG' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('文件不存在'));
    fireEvent.click(screen.getByRole('button', { name: '删除文件 第一章.JPG' }));
    fireEvent.click(screen.getByRole('button', { name: /^删除文件$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('文件已变化'));
    expect(state.url).toBe(toLocalFileUrl(path));
    expect(getUrlHistory(localStorage)).toEqual([toLocalFileUrl(path)]);
  });

  it('navigates folders and chooses a folder inside the native modal', async () => {
    render(<LocalFilesModal closeModal={vi.fn()} />);
    await screen.findByRole('button', { name: '打开文件夹 第二章' });
    fireEvent.click(screen.getByText('选择文件夹'));
    fireEvent.click(screen.getByText('use folder'));
    await waitFor(() => expect(listLocalFilesMock).toHaveBeenLastCalledWith('/home/deck/Pictures'));
    fireEvent.click(await screen.findByRole('button', { name: '打开文件夹 第二章' }));
    await waitFor(() =>
      expect(listLocalFilesMock).toHaveBeenLastCalledWith('/run/media/deck/SD/攻略/第二章'),
    );
  });

  it('ignores a file open that finishes after closing', async () => {
    let finish!: (value: unknown) => void;
    prepareLocalFileMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    const { unmount } = render(<LocalFilesModal closeModal={close} />);
    fireEvent.click(await screen.findByRole('button', { name: '打开文件 第一章.JPG' }));
    unmount();
    await act(async () => finish({ url: 'http://127.0.0.1/viewer/test' }));
    expect(close).not.toHaveBeenCalled();
    expect(state.visible).toBe(true);
  });
});
