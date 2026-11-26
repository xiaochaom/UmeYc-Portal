import { showModal } from '@decky/ui';
import { useEffect } from 'react';
import { useGlobalState } from '../hooks/global-state';
import { UrlModalWithState } from './url-modal';
import { LocalFilesModalWithState } from './local-files-modal';

export const NativePanel = ({ panel }: { panel: 'url' | 'files' }) => {
  const [, , context] = useGlobalState();
  useEffect(() => {
    let active = true;
    const close = () => {
      if (!active) return;
      const state = context.get();
      if (state.activePanel === panel) {
        context.set({ ...state, activePanel: undefined, visible: true });
      }
    };
    const Component = panel === 'url' ? UrlModalWithState : LocalFilesModalWithState;
    const modal = showModal(<Component value={context} />, undefined, {
      strTitle: panel === 'url' ? '网页' : '本地文件',
      bNeverPopOut: true,
      fnOnClose: close,
    });
    return () => {
      active = false;
      modal.Close();
    };
  }, [panel, context]);
  return null;
};
