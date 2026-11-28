import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StateManager } from 'cotton-box';
import { ViewMode } from './lib/util';
import { PORTAL_STORAGE_KEY } from './lib/storage';

vi.mock('@decky/ui', () => ({
  quickAccessMenuClasses: {
    Title: 'title',
  },
}));

vi.mock('./components/portal-view', () => ({
  PortalViewOuter: () => <div>Portal View Outer</div>,
}));

vi.mock('./components/settings', () => ({
  Settings: () => <div>Settings</div>,
}));

const loadState = async () => {
  await import('./index');
  const { routerHook } = await import('./__mocks__/decky-api');
  const factory = vi
    .mocked(routerHook.addGlobalComponent)
    .mock.calls.slice(-1)[0][1] as () => ReactElement;
  return factory().props.value as StateManager<Record<string, unknown>>;
};

describe('plugin entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('registers and deregisters global components', async () => {
    const { default: plugin } = await import('./index');
    const { routerHook } = await import('./__mocks__/decky-api');

    expect(plugin.name).toBe('UmeYc-Portal');
    expect(routerHook.addGlobalComponent).toHaveBeenCalledWith('Portal', expect.any(Function));

    (plugin as unknown as { onDismount: () => void }).onDismount();

    expect(routerHook.removeGlobalComponent).toHaveBeenCalledWith('Portal');
  });

  it('persists watched state values', async () => {
    await import('./index');
    const { routerHook } = await import('./__mocks__/decky-api');
    const { PORTAL_STORAGE_KEY } = await import('./lib/storage');

    const setItemSpy = vi.spyOn(globalThis.Storage.prototype, 'setItem');

    const globalComponentFactory = vi.mocked(routerHook.addGlobalComponent).mock.calls[0][1] as
      | (() => ReactElement)
      | undefined;

    expect(globalComponentFactory).toBeDefined();

    const provider = globalComponentFactory!();
    const stateManager = provider.props.value as StateManager<Record<string, unknown>>;
    expect(stateManager.get().viewMode).toBe(ViewMode.Closed);
    expect(stateManager.get().rightStickFullscreen).toBe(false);

    stateManager.set({
      viewMode: 2,
      previousViewMode: 2,
      visible: true,
      position: 3,
      margin: 45,
      size: 1.3,
      url: 'https://example.com',
      rightStickFullscreen: true,
    });

    expect(setItemSpy).toHaveBeenCalledWith(
      PORTAL_STORAGE_KEY,
      JSON.stringify({
        viewMode: ViewMode.Closed,
        position: 3,
        margin: 45,
        size: 1.3,
        url: 'https://example.com',
        rightStickFullscreen: true,
      }),
    );
  });

  it('starts closed on first install and when upgrading preferences without a saved switch', async () => {
    expect((await loadState()).get().viewMode).toBe(ViewMode.Closed);
    localStorage.setItem(
      PORTAL_STORAGE_KEY,
      JSON.stringify({ margin: 15, size: 1.2, url: 'https://youtube.com' }),
    );
    vi.resetModules();
    expect((await loadState()).get()).toMatchObject({
      viewMode: ViewMode.Closed,
      margin: 15,
      size: 1.2,
      url: 'https://youtube.com',
    });
  });

  it('ignores an enabled switch saved by .26', async () => {
    localStorage.setItem(
      PORTAL_STORAGE_KEY,
      JSON.stringify({
        viewMode: ViewMode.Sidebar,
        url: 'https://example.com/old-guide',
        rightStickFullscreen: true,
      }),
    );
    expect((await loadState()).get()).toMatchObject({
      viewMode: ViewMode.Closed,
      url: 'https://example.com/old-guide',
      rightStickFullscreen: true,
    });
  });

  it.each([ViewMode.Closed, ViewMode.Sidebar])(
    'starts closed after a session with switch %s, preserving preferences without temporary panels',
    async (viewMode) => {
      const state = await loadState();
      state.set({
        ...state.get(),
        viewMode: ViewMode.Sidebar,
        url: 'https://example.com/guide',
        sidebarVideoSpace: true,
        rightStickFullscreen: true,
      });
      state.set({
        ...state.get(),
        viewMode,
        visible: false,
        activePanel: 'url',
        readerFullscreen: true,
      });
      const plugin = (await import('./index')).default as unknown as { onDismount: () => void };
      plugin.onDismount();
      vi.resetModules();
      const restored = (await loadState()).get();
      expect(restored).toMatchObject({
        viewMode: ViewMode.Closed,
        url: 'https://example.com/guide',
        sidebarVideoSpace: true,
        rightStickFullscreen: true,
        visible: true,
        readerFullscreen: false,
      });
      expect(restored.activePanel).toBeUndefined();
    },
  );
});
