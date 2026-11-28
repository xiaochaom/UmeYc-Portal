import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { Router } from '@decky/ui';
import {
  prepareLocalFileMock,
  sendWebSpaceMock,
  getWebPageStateMock,
  setWebMediaMock,
} from '../__mocks__/decky-api';
import { toLocalFileUrl } from '../lib/local-files';
import { getOpenSideMenu, isSteamBlockingUI, isVirtualKeyboardShowing } from '../lib/menu-state';

vi.mock('../lib/menu-state', () => ({
  getOpenSideMenu: vi.fn(),
  isVirtualKeyboardShowing: vi.fn(),
  isSteamBlockingUI: vi.fn(),
}));
vi.mock('./reader-input', () => ({
  ReaderInput: ({ onFullscreenToggle }: { onFullscreenToggle: () => void }) => (
    <div data-testid="reader-input">
      <input aria-label="toggle fullscreen" type="button" onClick={onFullscreenToggle} />
    </div>
  ),
}));
vi.mock('./native-panel', () => ({
  NativePanel: ({ panel }: { panel: string }) => (
    <div data-testid="native-panel">{panel} modal</div>
  ),
}));
vi.mock('./phone-url-modal', () => ({ PhoneUrlModal: () => <div>phone panel</div> }));

import { PortalView, PortalViewOuter } from './portal-view';
import { StateManager } from 'cotton-box';
import { rememberUrl, historyLabel, getUrlHistory } from '../lib/url-history';
import { useGlobalState } from '../hooks/global-state';
import { Position, ViewMode } from '../lib/util';

const getGamepadNavigationTrees = vi.fn();
const createBrowserView = vi.fn();
const setVisible = vi.fn();
const setBounds = vi.fn();
const loadURL = vi.fn();
const destroy = vi.fn();
const useUIComposition = vi.fn();

vi.mock('../hooks/global-state', () => ({
  useGlobalState: vi.fn(),
}));

vi.mock('../hooks/use-ui-composition', () => ({
  UIComposition: {
    Notification: 1,
  },
  useUIComposition: (...args: unknown[]) => useUIComposition(...args),
}));

vi.mock('@decky/ui', () => ({
  quickAccessMenuClasses: { Tabs: 'tabs', TabGroupPanel: 'panel' },
  Router: {
    WindowStore: {
      GamepadUIMainWindowInstance: {
        CreateBrowserView: (...args: unknown[]) => createBrowserView(...args),
      },
    },
  },
  WindowRouter: {},
  getGamepadNavigationTrees: (...args: unknown[]) => getGamepadNavigationTrees(...args),
}));

const createState = (viewMode: ViewMode, position = Position.TopRight, margin = 20) => ({
  viewMode,
  previousViewMode: ViewMode.Picture,
  visible: true,
  position,
  margin,
  size: 1,
  url: 'https://netflix.com',
  controlBar: true,
});

describe('PortalView and PortalViewOuter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWebPageStateMock.mockReset();
    vi.mocked(getOpenSideMenu).mockReturnValue(2);
    vi.mocked(isVirtualKeyboardShowing).mockReturnValue(undefined);
    vi.mocked(isSteamBlockingUI).mockReturnValue(false);

    createBrowserView.mockReturnValue({
      GetBrowser: () => ({
        SetVisible: setVisible,
        SetBounds: setBounds,
      }),
      LoadURL: loadURL,
      Destroy: destroy,
    });

    getGamepadNavigationTrees.mockReturnValue([]);
  });

  it('returns null from outer component when closed', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Closed)] as never);

    const { container } = render(<PortalViewOuter />);

    expect(container).toBeEmptyDOMElement();
    expect(createBrowserView).not.toHaveBeenCalled();
  });

  const qamTree = () => ({
    id: 'QuickAccess-NA',
    m_Root: {
      m_element: {
        ownerDocument: {
          defaultView: {
            document: { hidden: false },
            screenLeft: 534,
            screenTop: 0,
            outerWidth: 320,
            outerHeight: 534,
          },
        },
      },
    },
  });

  it.each([false, true])(
    'keeps fullscreen synchronized with QAM, with sidebar space %s',
    async (sidebarVideoSpace) => {
      vi.useFakeTimers();
      try {
        let state = {
          ...createState(ViewMode.Sidebar),
          readerFullscreen: false,
          sidebarVideoSpace,
        };
        const refresh = () =>
          vi.mocked(useGlobalState).mockReturnValue([
            state,
            (update: (value: typeof state) => typeof state) => {
              state = update(state);
            },
          ] as never);
        refresh();
        const tree = qamTree();
        const popupRoot = document.createElement('div');
        Object.assign(tree.m_Root.m_element.ownerDocument.defaultView.document, {
          documentElement: popupRoot,
        });
        getGamepadNavigationTrees.mockReturnValue([tree]);
        const { getByLabelText, queryByTestId, container, rerender, unmount } = render(
          <PortalView />,
        );
        fireEvent.click(getByLabelText('toggle fullscreen'));
        expect(getOpenSideMenu()).toBe(2);
        expect(setWebMediaMock).not.toHaveBeenCalled();
        refresh();
        rerender(<PortalView />);
        expect(popupRoot.style.visibility).toBe('hidden');
        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        expect(setBounds).toHaveBeenLastCalledWith(0, 0, 854, 534);
        expect(setVisible).toHaveBeenLastCalledWith(true);
        expect(container.querySelector('button')).toBeNull();
        await act(async () => {
          vi.advanceTimersByTime(250);
        });
        expect(setWebMediaMock).not.toHaveBeenCalled();

        let finish!: () => void;
        setWebMediaMock.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
        vi.mocked(getOpenSideMenu).mockReturnValue(0);
        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        await act(async () => {
          vi.advanceTimersByTime(200);
        });
        expect(setWebMediaMock).toHaveBeenLastCalledWith('https://netflix.com', 'pause', '');
        expect(setVisible).toHaveBeenLastCalledWith(true);
        expect(queryByTestId('reader-input')).toBeNull();
        await act(async () => finish());
        expect(setVisible).toHaveBeenLastCalledWith(false);
        expect(setBounds).toHaveBeenLastCalledWith(0, 0, 854, 534);

        vi.mocked(getOpenSideMenu).mockReturnValue(2);
        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        expect(setVisible).toHaveBeenLastCalledWith(true);
        await act(async () => {
          vi.advanceTimersByTime(200);
        });
        expect(setWebMediaMock).toHaveBeenLastCalledWith('https://netflix.com', 'resume', '');
        fireEvent.click(getByLabelText('toggle fullscreen'));
        expect(getOpenSideMenu()).toBe(2);
        expect(setWebMediaMock).toHaveBeenCalledTimes(2);
        refresh();
        rerender(<PortalView />);
        expect(popupRoot.style.visibility).toBe('');
        vi.mocked(getOpenSideMenu).mockReturnValue(2);
        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);
        expect(setVisible).toHaveBeenLastCalledWith(true);
        expect(sendWebSpaceMock).not.toHaveBeenCalled();
        expect(loadURL).toHaveBeenCalledTimes(1);
        expect(destroy).not.toHaveBeenCalled();
        unmount();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('fills the screen for a local guide without web media commands', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        {
          ...createState(ViewMode.Sidebar),
          readerFullscreen: true,
          url: toLocalFileUrl('/tmp/guide.JPG'),
        },
        vi.fn(),
      ] as never);
      prepareLocalFileMock.mockResolvedValue({ url: 'http://127.0.0.1:1234/viewer/token' });
      const { unmount } = render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 854, 534);
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      expect(setWebMediaMock).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases composition and reader input for Steam blocking UI, then restores the page', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), sidebarVideoSpace: true },
      ] as never);
      const { queryByTestId, unmount } = render(<PortalView />);
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(queryByTestId('reader-input')).toBeTruthy();
      vi.mocked(isSteamBlockingUI).mockReturnValue(true);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      expect(useUIComposition).toHaveBeenCalledTimes(1);
      expect(queryByTestId('reader-input')).toBeNull();
      expect(destroy).not.toHaveBeenCalled();
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      vi.mocked(isSteamBlockingUI).mockReturnValue(false);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(useUIComposition).toHaveBeenLastCalledWith(1);
      expect(useUIComposition).toHaveBeenCalledTimes(2);
      expect(queryByTestId('reader-input')).toBeTruthy();
      expect(loadURL).toHaveBeenCalledTimes(1);
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides active Portal panels while Steam blocking UI is shown', () => {
    vi.mocked(isSteamBlockingUI).mockReturnValue(true);
    vi.mocked(useGlobalState).mockReturnValue([
      { ...createState(ViewMode.Sidebar), activePanel: 'phone' },
      vi.fn(),
    ] as never);
    const { getByLabelText } = render(<PortalView />);
    expect(getByLabelText('Portal 左侧面板')).toHaveStyle({ display: 'none' });
    expect(setVisible).toHaveBeenLastCalledWith(false);
  });

  it.each(['phone'] as const)(
    'shows %s only in the left reader area while keeping QAM open',
    (activePanel) => {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), activePanel },
        vi.fn(),
      ] as never);
      const { getByLabelText, queryByTestId } = render(<PortalView />);
      expect(getByLabelText('Portal 左侧面板')).toHaveStyle({
        left: '0px',
        top: '0px',
        width: '534px',
        height: '534px',
      });
      expect(getByLabelText('Portal 左侧面板')).toHaveTextContent(`${activePanel} panel`);
      expect(setVisible).toHaveBeenLastCalledWith(false);
      expect(queryByTestId('reader-input')).toBeNull();
      expect(getOpenSideMenu()).toBe(2);
    },
  );

  it.each(['url', 'files', 'help'] as const)(
    'opens %s as a native modal and suspends the reader',
    (activePanel) => {
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), activePanel },
        vi.fn(),
      ] as never);
      const { getByTestId, queryByLabelText, queryByTestId } = render(<PortalView />);
      expect(getByTestId('native-panel')).toHaveTextContent(`${activePanel} modal`);
      expect(queryByLabelText('Portal 左侧面板')).toBeNull();
      expect(queryByTestId('reader-input')).toBeNull();
      expect(setVisible).toHaveBeenLastCalledWith(false);
    },
  );

  it('sends space on sidebar edges only and pauses before hiding', async () => {
    vi.useFakeTimers();
    let finishPause!: () => void;
    try {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), sidebarVideoSpace: true },
      ] as never);
      sendWebSpaceMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishPause = resolve;
          }),
      );
      const { unmount } = render(<PortalView />);
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(sendWebSpaceMock).toHaveBeenCalledWith('https://netflix.com', '');
      expect(setVisible).toHaveBeenLastCalledWith(true);
      await act(async () => {
        finishPause();
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(sendWebSpaceMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(sendWebSpaceMock).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not toggle video when a dropdown temporarily hides the page', async () => {
    vi.useFakeTimers();
    try {
      let opened = false;
      const tree = qamTree();
      const mainTree = {
        id: 'GamepadUI_Full_Root',
        Root: {
          Element: {
            ownerDocument: {
              defaultView: {
                document: {
                  hidden: false,
                  querySelector: (s: string) =>
                    s.includes('listbox') && opened
                      ? { getBoundingClientRect: () => ({ width: 280 }) }
                      : null,
                },
              },
            },
          },
        },
      };
      getGamepadNavigationTrees.mockReturnValue([tree]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), sidebarVideoSpace: true },
      ] as never);
      const { unmount } = render(<PortalView />);
      // Steam closes QAM while presenting its dropdown in the main window.
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      getGamepadNavigationTrees.mockReturnValue([mainTree]);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      opened = true;
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      opened = false;
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      getGamepadNavigationTrees.mockReturnValue([tree]);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([ViewMode.Sidebar])(
    'keeps native dropdowns clickable with the sidebar and restores on cancellation',
    (mode) => {
      vi.useFakeTimers();
      try {
        let opened = false;
        const tree = qamTree();
        Object.assign(tree.m_Root.m_element.ownerDocument.defaultView.document, {
          querySelector: (selector: string) =>
            selector.includes('aria-expanded') && opened ? { getAttribute: () => 'true' } : null,
        });
        getGamepadNavigationTrees.mockReturnValue([tree]);
        vi.mocked(getOpenSideMenu).mockReturnValue(2);
        vi.mocked(useGlobalState).mockReturnValue([createState(mode)] as never);
        const { unmount } = render(<PortalView />);
        expect(setVisible).toHaveBeenLastCalledWith(true);
        opened = true;
        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(setVisible).toHaveBeenLastCalledWith(false);
        expect(destroy).not.toHaveBeenCalled();
        opened = false;
        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(setVisible).toHaveBeenLastCalledWith(true);
        expect(createBrowserView).toHaveBeenCalledTimes(1);
        unmount();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('fills the area left of QAM and hides without resizing or destroying on close', () => {
    vi.useFakeTimers();
    try {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), url: toLocalFileUrl('/tmp/guide.JPG') },
      ] as never);
      prepareLocalFileMock.mockResolvedValue({ url: 'http://127.0.0.1:1234/viewer/token' });
      const { container } = render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(container.querySelector('[data-testid="reader-input"]')).toBeTruthy();
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      expect(destroy).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="reader-input"]')).toBeNull();
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(createBrowserView).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures the sidebar content rather than its full-screen transparent popup', () => {
    const popup = {
      document: {
        hidden: false,
        querySelector: () => ({ getBoundingClientRect: () => ({ width: 48 }) }),
        querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 300 }) }],
      },
      outerWidth: 854,
      outerHeight: 534,
    };
    getGamepadNavigationTrees.mockReturnValue([
      { m_ID: 'QuickAccess-NA', Root: { Element: { ownerDocument: { defaultView: popup } } } },
    ]);
    vi.mocked(getOpenSideMenu).mockReturnValue(2);
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
    render(<PortalView />);
    expect(setBounds).toHaveBeenLastCalledWith(0, 34, 506, 500);
  });

  it('ignores a retained keyboard navigation tree after the keyboard is dismissed', () => {
    getGamepadNavigationTrees.mockReturnValue([
      qamTree(),
      {
        id: 'virtual keyboard',
        m_Root: { m_element: { ownerDocument: { defaultView: { document: { hidden: false } } } } },
      },
    ]);
    vi.mocked(getOpenSideMenu).mockReturnValue(2);
    vi.mocked(isVirtualKeyboardShowing).mockReturnValue(false);
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
    render(<PortalView />);
    expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);
  });

  it('keeps sidebar height after a physical touch clears Steam focus', async () => {
    const actual = await vi.importActual<typeof import('../lib/menu-state')>('../lib/menu-state');
    vi.mocked(getOpenSideMenu).mockImplementation(actual.getOpenSideMenu);
    vi.mocked(isVirtualKeyboardShowing).mockImplementation(actual.isVirtualKeyboardShowing);
    let menu = 2;
    const main = {
      MenuStore: { GetOpenSideMenu: () => menu },
      VirtualKeyboardManager: { IsShowingVirtualKeyboard: { Value: false } },
    };
    let focused: typeof main | null = main;
    const host = window as unknown as { SteamUIStore?: unknown };
    host.SteamUIStore = {
      GetFocusedWindowInstance: () => focused,
      WindowStore: { GamepadUIMainWindowInstance: main },
    };
    vi.useFakeTimers();
    try {
      getGamepadNavigationTrees.mockReturnValue([
        qamTree(),
        {
          id: 'virtual keyboard',
          m_Root: {
            m_element: { ownerDocument: { defaultView: { document: { hidden: false } } } },
          },
        },
      ]);
      vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
      const { unmount } = render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);
      focused = null;
      act(() => vi.advanceTimersByTime(100));
      expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);
      expect(setBounds).toHaveBeenCalledTimes(1);

      main.VirtualKeyboardManager.IsShowingVirtualKeyboard.Value = true;
      act(() => vi.advanceTimersByTime(100));
      expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 260);
      main.VirtualKeyboardManager.IsShowingVirtualKeyboard.Value = false;
      act(() => vi.advanceTimersByTime(100));
      expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);

      menu = 0;
      act(() => vi.advanceTimersByTime(100));
      expect(setVisible).toHaveBeenLastCalledWith(false);
      menu = 2;
      act(() => vi.advanceTimersByTime(100));
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);
      expect(createBrowserView).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      delete host.SteamUIStore;
      vi.useRealTimers();
    }
  });

  it('resolves a fresh preview address for a persisted local file', async () => {
    const path = '/run/media/deck/SD/明末第一章.JPG';
    const state = { ...createState(ViewMode.Sidebar), url: toLocalFileUrl(path) };
    vi.mocked(useGlobalState).mockReturnValue([state] as never);
    prepareLocalFileMock.mockResolvedValueOnce({ url: 'http://127.0.0.1:1234/viewer/new-token' });
    render(<PortalView />);
    await waitFor(() =>
      expect(loadURL).toHaveBeenCalledWith('http://127.0.0.1:1234/viewer/new-token'),
    );
    expect(prepareLocalFileMock).toHaveBeenCalledWith(path);
  });

  it('ignores a local preview response after switching back to a website', async () => {
    let resolve!: (value: { url: string }) => void;
    prepareLocalFileMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.mocked(useGlobalState).mockReturnValue([
      { ...createState(ViewMode.Sidebar), url: toLocalFileUrl('/tmp/guide.JPG') },
    ] as never);
    const { rerender } = render(<PortalView />);
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
    rerender(<PortalView />);
    await act(async () => {
      resolve({ url: 'http://127.0.0.1:1234/viewer/stale' });
    });
    expect(loadURL).toHaveBeenLastCalledWith('https://netflix.com');
    expect(loadURL).not.toHaveBeenCalledWith('http://127.0.0.1:1234/viewer/stale');
  });

  it('renders portal view from outer component when open', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);

    render(<PortalViewOuter />);

    expect(createBrowserView).toHaveBeenCalledTimes(1);
  });

  it('renders gracefully when decky main window instance is unavailable', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);

    const original = Router.WindowStore!.GamepadUIMainWindowInstance;
    Router.WindowStore!.GamepadUIMainWindowInstance = undefined as never;

    try {
      const { container } = render(<PortalView />);
      expect(container.querySelector('button')).toBeNull();
      expect(createBrowserView).not.toHaveBeenCalled();
    } finally {
      Router.WindowStore!.GamepadUIMainWindowInstance = original;
    }
  });

  it('updates deck component bounds only when interval polling detects changes', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    getGamepadNavigationTrees.mockImplementation(() => {
      callCount += 1;

      if (callCount < 3) {
        return [qamTree()];
      }

      return [
        {
          id: 'QuickAccess-NA',
          m_Root: {
            m_element: {
              ownerDocument: {
                defaultView: {
                  document: { hidden: false },
                  screenLeft: 0,
                  screenTop: 0,
                  outerWidth: 200,
                  outerHeight: 534,
                },
              },
            },
          },
        },
      ];
    });

    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);

    try {
      render(<PortalView />);

      expect(setBounds).toHaveBeenCalled();
      const initialCalls = setBounds.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setBounds).toHaveBeenCalledTimes(initialCalls);

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setBounds.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps same bounds when polling returns equal non-null rectangles', () => {
    vi.useFakeTimers();

    getGamepadNavigationTrees.mockReturnValue([
      {
        id: 'QuickAccess-NA',
        m_Root: {
          m_element: {
            ownerDocument: {
              defaultView: {
                document: { hidden: false },
                screenLeft: 0,
                screenTop: 0,
                outerWidth: 200,
                outerHeight: 534,
              },
            },
          },
        },
      },
    ]);

    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);

    try {
      render(<PortalView />);

      const initialCalls = setBounds.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(setBounds).toHaveBeenCalledTimes(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([ViewMode.Picture, ViewMode.Expand, ViewMode.Minimised])(
    'uses sidebar bounds even with stale legacy layout %s',
    (mode) => {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(useGlobalState).mockReturnValue([
        createState(mode, Position.BottomRight, 60),
      ] as never);
      const { container } = render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(0, 34, 534, 500);
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(container.querySelector('[data-testid="reader-input"]')).toBeTruthy();
      expect(container.querySelectorAll('button')).toHaveLength(3);
    },
  );

  it('creates and destroys the sidebar browser exactly once', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
    const { unmount } = render(<PortalView />);
    expect(loadURL).toHaveBeenCalledWith('https://netflix.com');
    expect(useUIComposition).toHaveBeenCalledWith(1);
    unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('syncs episode addresses and titles into history without reloading the playing video', async () => {
    vi.useFakeTimers();
    try {
      const short = 'https://b23.tv/short';
      const first = 'https://video.example/episode/1';
      const second = 'https://video.example/episode/2';
      const state = { ...createState(ViewMode.Sidebar), url: short };
      const manager = new StateManager(state);
      let actualUrl = first;
      let title = '第一集';
      let loading = true;
      rememberUrl(localStorage, short);
      getWebPageStateMock.mockImplementation(async () => ({ url: actualUrl, title }));
      createBrowserView.mockReturnValue({
        GetBrowser: () => ({ SetVisible: setVisible, SetBounds: setBounds }),
        LoadURL: loadURL,
        Destroy: destroy,
        URL: first, // Steam keeps this old value after a client-side episode switch.
        get Title() {
          return title;
        },
        BIsLoadingURL: () => loading,
      });
      const refresh = () =>
        vi.mocked(useGlobalState).mockReturnValue([manager.get(), vi.fn(), manager] as never);
      refresh();
      const { rerender, unmount } = render(<PortalView />);
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(getWebPageStateMock).not.toHaveBeenCalled();
      loading = false;
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(manager.get()).toMatchObject({ url: first, pageTitle: '第一集', pageTitleUrl: first });
      expect(getUrlHistory(localStorage)).toEqual([first]);
      refresh();
      rerender(<PortalView />);
      expect(loadURL).toHaveBeenCalledExactlyOnceWith(short);

      actualUrl = second;
      title = '第二集';
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(getWebPageStateMock).toHaveBeenLastCalledWith(first, '第二集');
      expect(manager.get()).toMatchObject({
        url: second,
        pageTitle: '第二集',
        pageTitleUrl: second,
      });
      expect(getUrlHistory(localStorage)).toEqual([second, first]);
      expect(historyLabel(localStorage, first)).toBe('第一集');
      expect(historyLabel(localStorage, second)).toBe('第二集');
      refresh();
      rerender(<PortalView />);
      expect(loadURL).toHaveBeenCalledTimes(1);

      actualUrl = first;
      title = '第一集';
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(getUrlHistory(localStorage)).toEqual([first, second]);
      refresh();
      rerender(<PortalView />);
      title = '第一集 · 更新标题';
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(historyLabel(localStorage, first)).toBe(title);
      expect(getUrlHistory(localStorage)).toEqual([first, second]);
      expect(loadURL).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late page snapshot after the user opens another address', async () => {
    vi.useFakeTimers();
    try {
      const state = createState(ViewMode.Sidebar);
      const manager = new StateManager(state);
      let finish!: (page: { url: string; title: string }) => void;
      getWebPageStateMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), manager] as never);
      const { rerender, unmount } = render(<PortalView />);
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      const next = { ...state, url: 'https://second.example/' };
      manager.set(next);
      vi.mocked(useGlobalState).mockReturnValue([next, vi.fn(), manager] as never);
      rerender(<PortalView />);
      await act(async () => finish({ url: 'https://old.example/', title: '过期标题' }));
      expect(manager.get()).toEqual(next);
      expect(getUrlHistory(localStorage)).not.toContain('https://old.example/');
      expect(loadURL).toHaveBeenLastCalledWith(next.url);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
