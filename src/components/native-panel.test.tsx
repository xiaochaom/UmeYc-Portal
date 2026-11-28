import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ShowModalProps } from '@decky/ui';
import { StateManager } from 'cotton-box';
import { GlobalContext, State } from '../hooks/global-state';
import { ViewMode } from '../lib/util';
import { NativePanel } from './native-panel';

const { showModalMock, closeMock } = vi.hoisted(() => ({
  showModalMock: vi.fn(),
  closeMock: vi.fn(),
}));
vi.mock('@decky/ui', () => ({ showModal: showModalMock }));
vi.mock('./url-modal', () => ({ UrlModalWithState: () => null }));
vi.mock('./local-files-modal', () => ({ LocalFilesModalWithState: () => null }));
vi.mock('./help-modal', () => ({ HelpModal: () => null }));

describe('native modal lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    showModalMock.mockImplementation(
      (_element: ReactElement, _parent: unknown, props: ShowModalProps) => {
        closeMock.mockImplementation(() => props.fnOnClose?.());
        return { Close: closeMock };
      },
    );
  });

  it.each(['url', 'files', 'help'] as const)(
    'opens %s with shared state and clears it on native dismiss',
    (panel) => {
      const state = new StateManager<State>({
        activePanel: panel,
        visible: true,
        viewMode: ViewMode.Closed,
      } as State);
      const { rerender, unmount } = render(
        <GlobalContext.Provider value={state}>
          <NativePanel panel={panel} />
        </GlobalContext.Provider>,
      );
      expect(showModalMock).toHaveBeenCalledTimes(1);
      if (panel !== 'help') expect(showModalMock.mock.calls[0][0].props.value).toBe(state);
      expect(showModalMock.mock.calls[0][2].bNeverPopOut).toBe(true);
      rerender(
        <GlobalContext.Provider value={state}>
          <NativePanel panel={panel} />
        </GlobalContext.Provider>,
      );
      expect(showModalMock).toHaveBeenCalledTimes(1);
      act(() => showModalMock.mock.calls[0][2].fnOnClose());
      expect(state.get()).toMatchObject({
        activePanel: undefined,
        visible: true,
        viewMode: ViewMode.Closed,
      });
      unmount();
      expect(closeMock).toHaveBeenCalledOnce();
    },
  );

  it('closes on unmount without overwriting a newer panel or reader state', () => {
    const state = new StateManager<State>({ activePanel: 'files', visible: false } as State);
    const { unmount } = render(
      <GlobalContext.Provider value={state}>
        <NativePanel panel="files" />
      </GlobalContext.Provider>,
    );
    act(() => state.set({ ...state.get(), activePanel: 'phone', viewMode: ViewMode.Closed }));
    unmount();
    expect(closeMock).toHaveBeenCalledOnce();
    expect(state.get()).toMatchObject({
      activePanel: 'phone',
      visible: false,
      viewMode: ViewMode.Closed,
    });
  });
});
