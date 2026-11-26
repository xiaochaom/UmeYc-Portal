import { DialogButton, Focusable, ModalRootProps } from '@decky/ui';
import { NativeDialog } from './native-dialog';
import { FolderPicker } from './folder-picker';
import { useEffect, useState } from 'react';
import { FaFolder, FaTrashAlt } from 'react-icons/fa';
import { useGlobalState } from '../hooks/global-state';
import {
  deleteLocalFile,
  listLocalFiles,
  localPathFromUrl,
  LOCAL_DIRECTORY_KEY,
  LocalEntry,
  LocalListing,
  prepareLocalFile,
  toLocalFileUrl,
} from '../lib/local-files';
import { removeUrl } from '../lib/url-history';
import { ViewMode } from '../lib/util';
import { getUploadDirectory, UPLOAD_DIRECTORY_KEY } from '../lib/phone-input';
import { modalWithState } from './modal';

export const LocalFilesModal = (props: ModalRootProps) => {
  const [, setGlobalState] = useGlobalState();
  const [directory, setDirectory] = useState<string | null>(null);
  const [listing, setListing] = useState<LocalListing | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<LocalEntry | null>(null);
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [lifetime] = useState(() => ({ active: true }));

  useEffect(() => {
    lifetime.active = true;
    setGlobalState((state) => ({ ...state, visible: false }));
    return () => {
      lifetime.active = false;
      setGlobalState((state) => ({ ...state, visible: true }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const selected = directory
      ? Promise.resolve({ directory })
      : getUploadDirectory(localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '');
    void selected
      .then((result) => listLocalFiles(result.directory))
      .then(
        (result) => {
          if (!active) return;
          setListing(result);
          localStorage.setItem(LOCAL_DIRECTORY_KEY, result.directory);
        },
        (cause) => {
          if (active) {
            setListing(null);
            setError(String(cause));
          }
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [directory, revision]);

  const open = async (entry: LocalEntry) => {
    if (entry.directory) return setDirectory(entry.path);
    setBusy(true);
    setError('');
    try {
      await prepareLocalFile(entry.path);
      if (!lifetime.active) return;
      setGlobalState((state) => ({
        ...state,
        url: toLocalFileUrl(entry.path),
        viewMode: ViewMode.Sidebar,
        visible: true,
      }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setError(`无法打开本地文件：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const remove = async () => {
    if (!pending?.delete_token) return;
    setBusy(true);
    setError('');
    try {
      const deleted = await deleteLocalFile(pending.delete_token);
      removeUrl(localStorage, toLocalFileUrl(deleted.path));
      if (!lifetime.active) return;
      setGlobalState((state) =>
        localPathFromUrl(state.url) === deleted.path
          ? {
              ...state,
              url: '',
              pageTitle: undefined,
              pageTitleUrl: undefined,
              viewMode: ViewMode.Closed,
            }
          : state,
      );
      setPending(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (lifetime.active) setError(`无法删除文件：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  if (pickingDirectory)
    return (
      <FolderPicker
        native
        initial={listing?.directory || '/run/media'}
        onCancel={() => setPickingDirectory(false)}
        onChoose={(path) => {
          setDirectory(path);
          setPickingDirectory(false);
        }}
      />
    );

  return (
    <NativeDialog
      {...props}
      key={pending ? 'delete' : 'files'}
      strTitle={pending ? '删除本地文件' : '本地文件'}
      strOKButtonText={pending ? '删除文件' : '关闭'}
      strCancelButtonText="取消"
      bAlertDialog={!pending}
      bOKDisabled={busy}
      bCancelDisabled={busy}
      onOK={() => (pending ? void remove() : props.closeModal?.())}
      onCancel={() => (pending ? setPending(null) : props.closeModal?.())}
    >
      {pending ? (
        <div>
          <p>确定删除「{pending.name}」吗？删除后无法恢复。</p>
          <p style={{ fontSize: 12, opacity: 0.7, overflowWrap: 'anywhere' }}>{pending.path}</p>
        </div>
      ) : (
        <Focusable
          flow-children="column"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <Focusable flow-children="row" style={{ display: 'flex', gap: 8 }}>
            <DialogButton
              onClick={() => setPickingDirectory(true)}
              disabled={busy}
              style={{ flex: '1 1 0', width: 0, minWidth: 0, whiteSpace: 'nowrap' }}
            >
              选择文件夹
            </DialogButton>
            <DialogButton
              onClick={() => setRevision((value) => value + 1)}
              disabled={busy || loading}
              style={{ flex: '1 1 0', width: 0, minWidth: 0, whiteSpace: 'nowrap' }}
            >
              刷新
            </DialogButton>
          </Focusable>
          <div style={{ fontSize: 12, opacity: 0.7, overflowWrap: 'anywhere' }}>
            {listing?.directory || directory}
          </div>
          {listing && listing.parent !== listing.directory && (
            <DialogButton disabled={busy || loading} onClick={() => setDirectory(listing.parent)}>
              上一级
            </DialogButton>
          )}
          {loading ? (
            <p role="status">正在读取文件…</p>
          ) : (
            <Focusable
              flow-children="column"
              style={{
                maxHeight: '38vh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {listing?.entries.length === 0 && <p>此文件夹没有可打开的攻略文件。</p>}
              {listing?.entries.map((entry) => (
                <Focusable
                  key={entry.path}
                  flow-children="row"
                  style={{ display: 'flex', gap: 8, minWidth: 0 }}
                >
                  <DialogButton
                    aria-label={`打开${entry.directory ? '文件夹' : '文件'} ${entry.name}`}
                    disabled={busy}
                    onClick={() => void open(entry)}
                    style={{ flex: '1 1 0', minWidth: 0, textAlign: 'left', padding: '10px 12px' }}
                  >
                    <span
                      title={entry.name}
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.directory && (
                        <FaFolder style={{ marginRight: 8 }} aria-hidden="true" />
                      )}
                      {entry.name}
                    </span>
                  </DialogButton>
                  {!entry.directory && entry.delete_token && (
                    <DialogButton
                      aria-label={`删除文件 ${entry.name}`}
                      disabled={busy}
                      onClick={() => {
                        setPending(entry);
                        setError('');
                      }}
                      style={{ flex: '0 0 40px', minWidth: 40, padding: 8 }}
                    >
                      <FaTrashAlt size={18} aria-hidden="true" />
                    </DialogButton>
                  )}
                </Focusable>
              ))}
              {listing?.truncated && <p>文件较多，仅显示前 500 项，请进入更具体的文件夹。</p>}
            </Focusable>
          )}
        </Focusable>
      )}
      {error && <p role="alert">{error}</p>}
    </NativeDialog>
  );
};

export const LocalFilesModalWithState = modalWithState(LocalFilesModal);
