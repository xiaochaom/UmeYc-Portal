import { Focusable, TextField, ModalRootProps } from '@decky/ui';
import { NativeDialog } from './native-dialog';
import { useEffect, useState } from 'react';

import { modalWithState } from './modal';
import { useGlobalState } from '../hooks/global-state';
import { editableAddress, localPathFromUrl, prepareLocalFile } from '../lib/local-files';
import { UrlHistoryList } from './url-history-list';
import { ViewMode } from '../lib/util';

export const UrlModal = (props: ModalRootProps) => {
  const [{ url }, setGlobalState] = useGlobalState();
  const [field, setField] = useState(() => editableAddress(url));
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [lifetime] = useState(() => ({ active: true }));

  useEffect(() => {
    lifetime.active = true;
    setGlobalState((state) => ({
      ...state,
      visible: false,
    }));

    return () => {
      lifetime.active = false;
      setGlobalState((state) => ({
        ...state,
        visible: true,
      }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (address: string) => {
    setOpening(true);
    setError('');
    try {
      const path = localPathFromUrl(address);
      if (path) await prepareLocalFile(path);
      if (!lifetime.active) return;
      setGlobalState((state) => ({
        ...state,
        visible: true,
        url: address,
        viewMode: ViewMode.Sidebar,
      }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setError(`无法打开网页或本地文件：${String(cause)}`);
    } finally {
      if (lifetime.active) setOpening(false);
    }
  };

  return (
    <NativeDialog
      {...props}
      strTitle="网页"
      strOKButtonText="打开"
      strCancelButtonText="取消"
      bOKDisabled={opening || !field.trim()}
      onOK={() => void open(field.trim())}
      onCancel={() => {
        setGlobalState((state) => ({
          ...state,
          visible: true,
        }));
        props.closeModal?.();
      }}
    >
      <Focusable flow-children="column" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        <TextField
          label="网址或图片地址"
          description="输入攻略网页或图片地址；SD 卡上的图片请使用「本地文件」"
          value={field}
          disabled={opening}
          onChange={(e) => setField(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <div style={{ marginTop: 16, borderTop: '1px solid #36404d', paddingTop: 12 }}>
          <UrlHistoryList opening={opening} onOpen={(address) => void open(address)} />
        </div>
      </Focusable>
    </NativeDialog>
  );
};

export const UrlModalWithState = modalWithState(UrlModal);
