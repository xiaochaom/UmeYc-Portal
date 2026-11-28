import { FaTv } from 'react-icons/fa';
import { StateManager } from 'cotton-box';
import { quickAccessMenuClasses } from '@decky/ui';
import { definePlugin, routerHook } from '@decky/api';

import { PortalViewOuter } from './components/portal-view';
import { Settings } from './components/settings';
import { Position, ViewMode } from './lib/util';
import { State, GlobalContext } from './hooks/global-state';
import { getPersistedPortalState, PORTAL_STORAGE_KEY } from './lib/storage';
import { rememberUrl } from './lib/url-history';

export default definePlugin(() => {
  const defaultState: State = {
    viewMode: ViewMode.Closed,
    previousViewMode: ViewMode.Sidebar,
    visible: true,
    position: Position.TopRight,
    margin: 30,
    size: 1,
    url: 'https://netflix.com',
    controlBar: false,
    sidebarVideoSpace: false,
    rightStickFullscreen: false,
  };

  const state = new StateManager<State>({
    ...defaultState,
    ...getPersistedPortalState(localStorage),
    // Opening the reader is session-only, including when upgrading from .26.
    viewMode: ViewMode.Closed,
    readerFullscreen: false,
  });

  let lastUrl: string | undefined;
  state.watch(({ position, margin, size, url, sidebarVideoSpace, rightStickFullscreen }) => {
    localStorage.setItem(
      PORTAL_STORAGE_KEY,
      JSON.stringify({
        viewMode: ViewMode.Closed,
        position,
        margin,
        size,
        url,
        sidebarVideoSpace,
        rightStickFullscreen,
      }),
    );
    if (url !== lastUrl) {
      lastUrl = url;
      rememberUrl(localStorage, url);
    }
  });

  routerHook.addGlobalComponent('Portal', () => {
    return (
      <GlobalContext.Provider value={state}>
        <PortalViewOuter />
      </GlobalContext.Provider>
    );
  });

  return {
    name: 'UmeYc-Portal',
    titleView: <div className={quickAccessMenuClasses.Title}>UmeYc-Portal</div>,
    icon: <FaTv />,
    content: (
      <GlobalContext.Provider value={state}>
        <Settings />
      </GlobalContext.Provider>
    ),
    onDismount() {
      routerHook.removeGlobalComponent('Portal');
    },
  };
});
