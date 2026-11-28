import { Router, WindowRouter, getGamepadNavigationTrees, quickAccessMenuClasses } from '@decky/ui';
import { useEffect, useRef, useState } from 'react';
import { callable, toaster } from '@decky/api';

import { useGlobalState } from '../hooks/global-state';
import { intersectRectangles } from '../lib/geometry';
import { UIComposition, useUIComposition } from '../hooks/use-ui-composition';
import { localPathFromUrl, prepareLocalFile } from '../lib/local-files';
import { getOpenSideMenu, isSteamBlockingUI, isVirtualKeyboardShowing } from '../lib/menu-state';
import { ReaderInput } from './reader-input';
import { WebHeader, WEB_HEADER_HEIGHT } from './web-header';
import { rememberPageTitle, rememberUrl, removeUrl } from '../lib/url-history';
import { NativePanel } from './native-panel';
import { PhoneUrlModal } from './phone-url-modal';
import { SCREEN_HEIGHT, SCREEN_WIDTH, ViewMode } from '../lib/util';

interface BrowserProps {
  url: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  preserveHiddenBounds?: boolean;
  sidebarOpen?: boolean;
  playbackSpace?: boolean;
  suppressPlayback?: boolean;
  pageTitle?: string;
  fullscreen?: boolean;
}

interface BrowserHandle {
  SetVisible(visible: boolean): void;
  SetBounds(x: number, y: number, width: number, height: number): void;
}

interface BrowserViewHandle {
  GetBrowser(): BrowserHandle;
  LoadURL(url: string): void;
  Destroy(): void;
  URL?: string;
  Title?: string;
  BIsLoadingURL?(): boolean;
  StartRequestCallbacks?: { Register(callback: () => void): { Unregister(): void } };
  FinishedRequestCallbacks?: { Register(callback: () => void): { Unregister(): void } };
}

interface MainWindowInstance {
  CreateBrowserView(name: string): BrowserViewHandle;
}

interface NavTree {
  id?: string;
  m_ID?: string;
  Root?: { Element?: { ownerDocument?: { defaultView?: DeckWindow | null } } };
  m_Root?: {
    m_element?: {
      ownerDocument?: {
        defaultView?: DeckWindow | null;
      };
    };
  };
}

interface DeckWindow {
  document: {
    documentElement?: { style: typeof document.documentElement.style };
    hidden: boolean;
    querySelector?: (selector: string) => {
      getBoundingClientRect(): { width: number };
      getAttribute?(name: string): string | null;
    } | null;
    querySelectorAll?: (
      selector: string,
    ) => ArrayLike<{ getBoundingClientRect(): { width: number } }>;
  };
  screenLeft?: number;
  screenTop?: number;
  outerWidth?: number;
  outerHeight?: number;
}

const sendWebSpace = callable<[url: string, title: string], void>('send_web_space');
const setWebMedia = callable<[url: string, action: 'pause' | 'resume', title: string], void>(
  'set_web_media',
);
const getWebPageState = callable<[url: string, title: string], { url: string; title: string }>(
  'get_web_page_state',
);

const BrowserComposition = () => {
  useUIComposition(UIComposition.Notification);
  return null;
};

const Browser = ({
  url,
  visible,
  x,
  y,
  width,
  height,
  preserveHiddenBounds,
  sidebarOpen,
  playbackSpace,
  suppressPlayback,
  pageTitle,
  fullscreen,
}: BrowserProps) => {
  const [, , stateContext] = useGlobalState();
  const web = /^https?:\/\//i.test(url);

  const [handles] = useState<{ browser: BrowserHandle; view: BrowserViewHandle } | null>(() => {
    const root = Router.WindowStore?.GamepadUIMainWindowInstance as
      | (WindowRouter & MainWindowInstance)
      | undefined;
    if (!root) {
      return null;
    }

    const view = root.CreateBrowserView('portal');
    const browser = view.GetBrowser();

    (window as unknown as { portal?: BrowserViewHandle }).portal = view;

    return {
      view,
      browser,
    };
  });

  const observedUrl = useRef<string | null>(null);
  const pendingNavigation = useRef<string | null>(url);

  const previousPlayback = useRef({ url, sidebarOpen, playbackSpace });
  useEffect(() => {
    if (suppressPlayback) {
      handles?.browser.SetVisible(visible);
      return;
    }
    const previous = previousPlayback.current;
    if (!handles) return;
    const toggle =
      web &&
      (fullscreen || (playbackSpace && previous.playbackSpace)) &&
      previous.url === url &&
      previous.sidebarOpen !== sidebarOpen;
    if (!toggle) {
      previousPlayback.current = { url, sidebarOpen, playbackSpace };
      handles.browser.SetVisible(visible);
      return;
    }
    let cancelled = false;
    // Show before resuming, and finish sending pause before hiding. Dropdowns
    // only change visible; they never change sidebarOpen or toggle playback.
    if (sidebarOpen) handles.browser.SetVisible(visible);
    // Steam closes QAM before its combobox commits aria-expanded. Wait for
    // that short transition so a dropdown can suppress the pending key.
    const timer = setTimeout(() => {
      previousPlayback.current = { url, sidebarOpen, playbackSpace };
      void (
        fullscreen
          ? setWebMedia(
              handles.view.URL || url,
              sidebarOpen ? 'resume' : 'pause',
              handles.view.Title || '',
            )
          : sendWebSpace(handles.view.URL || url, handles.view.Title || '')
      )
        .catch((error: unknown) =>
          toaster.toast({ title: '网页播放控制失败', body: String(error) }),
        )
        .finally(() => {
          if (!cancelled && !sidebarOpen) handles.browser.SetVisible(visible);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handles, visible, url, sidebarOpen, playbackSpace, suppressPlayback, fullscreen, web]);

  useEffect(() => {
    if (!handles) return;
    // A pushState/replaceState observation updates settings and persistence,
    // but must never reload the video that is already playing.
    if (observedUrl.current === url) return;
    observedUrl.current = null;
    pendingNavigation.current = url;
    let cancelled = false;
    try {
      const path = localPathFromUrl(url);
      if (path !== null) {
        void prepareLocalFile(path).then(
          (result) => {
            if (!cancelled) handles.view.LoadURL(result.url);
          },
          (error: unknown) => {
            if (!cancelled) toaster.toast({ title: '无法打开本地文件', body: String(error) });
          },
        );
      } else {
        handles.view.LoadURL(url);
      }
    } catch (error) {
      toaster.toast({ title: '无法打开本地文件', body: String(error) });
    }
    return () => {
      cancelled = true;
    };
  }, [url, handles]);

  useEffect(() => {
    if (!web || !handles || !visible || !stateContext) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!handles.view.BIsLoadingURL?.()) {
          const nativeUrl = handles.view.URL || url;
          const nativeTitle = handles.view.Title || '';
          const page = await getWebPageState(nativeUrl, nativeTitle);
          const current = stateContext.get();
          if (
            active &&
            current.url === url &&
            !handles.view.BIsLoadingURL?.() &&
            nativeUrl === (handles.view.URL || url) &&
            nativeTitle === (handles.view.Title || '') &&
            /^https?:\/\//i.test(page.url)
          ) {
            if (page.url !== url) {
              // Resolve an initial short link into one history item. Later
              // episode switches retain the previous episode as a separate item.
              if (pendingNavigation.current === url) removeUrl(localStorage, url);
              observedUrl.current = page.url;
              rememberUrl(localStorage, page.url);
            }
            pendingNavigation.current = null;
            rememberPageTitle(localStorage, page.url, page.title);
            if (
              current.url !== page.url ||
              current.pageTitle !== page.title ||
              current.pageTitleUrl !== page.url
            ) {
              stateContext.set({
                ...current,
                url: page.url,
                pageTitle: page.title,
                pageTitleUrl: page.url,
              });
            }
          }
        }
      } catch {
        // Navigation can temporarily remove its debugger target. Retry the
        // next snapshot; never write a previous page's title to a new address.
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000);
      }
    };
    timer = setTimeout(() => void poll(), 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [url, handles, web, visible, stateContext]);

  useEffect(() => {
    if (preserveHiddenBounds && !visible) return;
    handles?.browser.SetBounds(
      x,
      y + (web && !fullscreen ? WEB_HEADER_HEIGHT : 0),
      width,
      Math.max(1, height - (web && !fullscreen ? WEB_HEADER_HEIGHT : 0)),
    );
  }, [handles, x, y, width, height, preserveHiddenBounds, visible, web, fullscreen]);

  useEffect(() => {
    return () => handles?.view.Destroy();
  }, [handles]);

  // Unmount the request entirely when hidden. Requesting Hidden (0) would also
  // override Steam's fallback to Opaque on the credential-error route.
  return (
    <>
      {visible && <BrowserComposition />}
      {web && !fullscreen && visible && handles && (
        <WebHeader
          title={pageTitle || ''}
          getUrl={() => handles.view.URL || url}
          getTitle={() => handles.view.Title || ''}
          x={x}
          y={y}
          width={width}
        />
      )}
    </>
  );
};

const getBounds = (windowView?: DeckWindow | null) => {
  return {
    x: windowView?.screenLeft ?? 0,
    y: windowView?.screenTop ?? 0,
    width: windowView?.outerWidth ?? 0,
    height: windowView?.outerHeight ?? 0,
  };
};

const getOwnerWindow = (trees: NavTree[], id: string) => {
  const tree = trees.find((tree) => (tree.id ?? tree.m_ID) === id);
  return (
    tree?.Root?.Element?.ownerDocument?.defaultView ??
    tree?.m_Root?.m_element?.ownerDocument?.defaultView ??
    null
  );
};

const getQuickAccessBounds = (windowView: DeckWindow | null) => {
  const bounds = getBounds(windowView);
  const doc = windowView?.document;
  const tabs = doc?.querySelector?.(`[class~="${quickAccessMenuClasses.Tabs}"]`);
  const panels = doc?.querySelectorAll?.(`[class~="${quickAccessMenuClasses.TabGroupPanel}"]`);
  const panelWidth = Math.max(
    0,
    ...Array.from(panels ?? []).map((p) => p.getBoundingClientRect().width),
  );
  const contentWidth = (tabs?.getBoundingClientRect().width ?? 0) + panelWidth;
  // CEF popup outerWidth may describe its full-screen transparent backing surface.
  if (contentWidth > 0) bounds.width = contentWidth;
  if (bounds.width <= 0 || bounds.width >= SCREEN_WIDTH) bounds.width = 348;
  return bounds;
};

const getDeckComponentBounds = () => {
  const trees = (getGamepadNavigationTrees() ?? []) as NavTree[];

  const nav = getOwnerWindow(trees, 'MainNavMenuContainer');
  const openSideMenu = getOpenSideMenu();
  const navHidden =
    openSideMenu === undefined ? (nav?.document.hidden ?? true) : openSideMenu !== 1;
  const navBounds = navHidden ? null : getBounds(nav);

  const qam = getOwnerWindow(trees, 'QuickAccess-NA');
  const qamHidden =
    openSideMenu === undefined ? (qam?.document.hidden ?? true) : openSideMenu !== 2;
  const qamBounds = qamHidden ? null : getQuickAccessBounds(qam);
  // Steam may unmount the entire QAM body while showing a dropdown. Observe
  // the actual listbox in its main window as well as the original combobox.
  const main = getOwnerWindow(trees, 'GamepadUI_Full_Root') ?? getOwnerWindow(trees, 'root_1_');
  const listbox = main?.document.querySelector?.('[role="listbox"]');
  const dropdownOpen =
    (listbox?.getBoundingClientRect().width ?? 0) > 0 ||
    qam?.document
      .querySelector?.('[role="combobox"][aria-expanded="true"]')
      ?.getAttribute?.('aria-expanded') === 'true';

  const virtualKeyboard = getOwnerWindow(trees, 'virtual keyboard');
  const virtualKeyboardHidden = !(
    isVirtualKeyboardShowing() ??
    (virtualKeyboard && !virtualKeyboard.document.hidden)
  );
  // this is a guess, gotta figure out how to inspect to keyboard DOM
  const virtualKeyboardBounds = virtualKeyboardHidden
    ? null
    : {
        x: 0,
        y: SCREEN_HEIGHT - 240,
        width: SCREEN_WIDTH,
        height: 240,
      };

  return {
    nav: navBounds,
    qam: qamBounds,
    virtualKeyboard: virtualKeyboardBounds,
    qamOpen: !qamHidden,
    dropdownOpen,
    steamBlockingUI: isSteamBlockingUI(),
    pageTitle: (window as unknown as { portal?: BrowserViewHandle }).portal?.Title,
  };
};

const areRectanglesEqual = (
  first: { x: number; y: number; width: number; height: number } | null,
  second: { x: number; y: number; width: number; height: number } | null,
) => {
  if (!first && !second) {
    return true;
  }

  if (!first || !second) {
    return false;
  }

  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
};

const areDeckComponentBoundsEqual = (
  first: ReturnType<typeof getDeckComponentBounds>,
  second: ReturnType<typeof getDeckComponentBounds>,
) => {
  return (
    areRectanglesEqual(first.nav, second.nav) &&
    areRectanglesEqual(first.qam, second.qam) &&
    areRectanglesEqual(first.virtualKeyboard, second.virtualKeyboard) &&
    first.qamOpen === second.qamOpen &&
    first.dropdownOpen === second.dropdownOpen &&
    first.steamBlockingUI === second.steamBlockingUI &&
    first.pageTitle === second.pageTitle
  );
};

const useDeckComponentBounds = () => {
  const [state, setState] = useState(getDeckComponentBounds);

  useEffect(() => {
    const interval = setInterval(() => {
      setState((current) => {
        const next = getDeckComponentBounds();
        return areDeckComponentBoundsEqual(next, current) ? current : next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return state;
};

export const PortalView = () => {
  const {
    nav,
    qam,
    virtualKeyboard,
    qamOpen,
    dropdownOpen,
    steamBlockingUI,
    pageTitle: nativeTitle,
  } = useDeckComponentBounds();
  const [
    {
      url,
      visible,
      sidebarVideoSpace,
      rightStickFullscreen,
      readerFullscreen,
      activePanel,
      pageTitle,
      pageTitleUrl,
    },
    setGlobalState,
  ] = useGlobalState();
  const presentationOpen = qamOpen;
  const readerVisible =
    !!url && visible && !activePanel && !dropdownOpen && !steamBlockingUI && presentationOpen;
  const changeFullscreen = (enabled: boolean) => {
    if (enabled === !!readerFullscreen) return;
    setGlobalState((state) => ({ ...state, readerFullscreen: enabled }));
  };
  useEffect(() => {
    if (!readerFullscreen || !qamOpen || activePanel || steamBlockingUI) return;
    const qamWindow = getOwnerWindow(
      (getGamepadNavigationTrees() ?? []) as NavTree[],
      'QuickAccess-NA',
    );
    const style = qamWindow?.document.documentElement?.style;
    if (!style) return;
    const previous = style.getPropertyValue('visibility');
    const priority = style.getPropertyPriority('visibility');
    // Keep Steam's menu state and physical ... button unchanged. Only conceal
    // its separate transparent popup while the reader occupies the full screen.
    style.setProperty('visibility', 'hidden', 'important');
    return () => {
      if (previous) style.setProperty('visibility', previous, priority);
      else style.removeProperty('visibility');
    };
  }, [readerFullscreen, qamOpen, activePanel, steamBlockingUI]);
  const closePanel = () =>
    setGlobalState((state) => ({ ...state, activePanel: undefined, visible: true }));
  const nativePanel =
    activePanel === 'url' || activePanel === 'files' || activePanel === 'help'
      ? activePanel
      : undefined;
  const localPath = (() => {
    try {
      return localPathFromUrl(url);
    } catch {
      return null;
    }
  })();

  const availableBounds = [
    {
      x: 0,
      y: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    },
  ];

  if (nav && !readerFullscreen) {
    availableBounds.push({
      x: nav.width,
      y: 0,
      width: SCREEN_WIDTH - nav.width,
      height: SCREEN_HEIGHT,
    });
  }

  if (qam && !readerFullscreen) {
    availableBounds.push({
      x: 0,
      y: 0,
      width: SCREEN_WIDTH - qam.width,
      height: SCREEN_HEIGHT,
    });
  }

  if (virtualKeyboard && !readerFullscreen) {
    availableBounds.push({
      x: 0,
      y: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT - virtualKeyboard.height,
    });
  }

  const bounds = intersectRectangles(availableBounds) ?? {
    x: 0,
    y: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  };

  return (
    <>
      {url && (
        <Browser
          url={url}
          visible={readerVisible}
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          preserveHiddenBounds
          sidebarOpen={presentationOpen}
          fullscreen={readerFullscreen === true}
          playbackSpace={sidebarVideoSpace === true && /^https?:\/\//i.test(url)}
          suppressPlayback={dropdownOpen || !!activePanel || steamBlockingUI}
          pageTitle={pageTitleUrl === url ? pageTitle || nativeTitle : nativeTitle}
        />
      )}
      {readerVisible && (
        <ReaderInput
          key={url}
          path={localPath ?? undefined}
          fullscreen={rightStickFullscreen === true && /^https?:\/\//i.test(url)}
          onFullscreenToggle={() => changeFullscreen(!readerFullscreen)}
        />
      )}
      {nativePanel && <NativePanel panel={nativePanel} />}
      {activePanel === 'phone' && (
        <div
          aria-label="Portal 左侧面板"
          style={{
            position: 'absolute',
            zIndex: 7001,
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            display: qamOpen && !steamBlockingUI ? 'block' : 'none',
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          <PhoneUrlModal closeModal={closePanel} />
        </div>
      )}
    </>
  );
};

export const PortalViewOuter = () => {
  const [{ viewMode, activePanel }] = useGlobalState();

  if (viewMode === ViewMode.Closed && !activePanel) {
    return null;
  }

  return <PortalView />;
};
