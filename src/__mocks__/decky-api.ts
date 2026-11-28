import { vi } from 'vitest';

export const definePlugin = vi.fn((factory: unknown) =>
  typeof factory === 'function' ? (factory as () => unknown)() : factory,
);

export const routerHook = {
  addGlobalComponent: vi.fn(),
  removeGlobalComponent: vi.fn(),
};

export const toaster = {
  toast: vi.fn(),
};

export const openFilePicker = vi.fn();
export const FileSelectionType = { FILE: 0, FOLDER: 1 };
export const prepareLocalFileMock = vi.fn();
export const listLocalFilesMock = vi.fn();
export const deleteLocalFileMock = vi.fn();
export const getUploadDirectoryMock = vi.fn(async () => ({ directory: '/run/media/deck/SD/攻略' }));
export const zoomReaderMock = vi.fn(async (): Promise<void> => undefined);
export const setReaderMotionMock = vi.fn(async () => undefined);
export const scrollWebPageMock = vi.fn(async () => undefined);
export const releaseWebScrollMock = vi.fn(async () => undefined);
export const zoomWebPageMock = vi.fn(async () => ({ factor: 1 }));
export const sendWebSpaceMock = vi.fn(async (): Promise<void> => undefined);
export const toggleWebFullscreenMock = vi.fn(async (): Promise<void> => undefined);
export const setWebMediaMock = vi.fn(async (): Promise<void> => undefined);
export const getWebPageStateMock = vi.fn();
export const startUrlInputMock = vi.fn();
export const getUrlInputStatusMock = vi.fn();
export const cancelUrlInputMock = vi.fn(async () => undefined);
export const callable = vi.fn((route: string) => {
  const methods: Record<string, unknown> = {
    zoom_reader: zoomReaderMock,
    set_reader_motion: setReaderMotionMock,
    scroll_web_page: scrollWebPageMock,
    release_web_scroll: releaseWebScrollMock,
    zoom_web_page: zoomWebPageMock,
    send_web_space: sendWebSpaceMock,
    toggle_web_fullscreen: toggleWebFullscreenMock,
    set_web_media: setWebMediaMock,
    get_web_page_state: getWebPageStateMock,
    prepare_local_file: prepareLocalFileMock,
    list_local_files: listLocalFilesMock,
    delete_local_file: deleteLocalFileMock,
    get_upload_directory: getUploadDirectoryMock,
    start_url_input: startUrlInputMock,
    get_url_input_status: getUrlInputStatusMock,
    cancel_url_input: cancelUrlInputMock,
  };
  return methods[route];
});
