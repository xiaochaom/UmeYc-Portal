import { findModuleExport } from '@decky/ui';
import { callable, toaster } from '@decky/api';
import { useEffect, useRef, useState } from 'react';
import { getActiveControllerIndex } from '../lib/controller';
import type { ZoomAction } from './web-header';

interface AxesState {
  RightJoystick?: { x: number; y: number };
}

// Steam starts/stops its native raw controller feed inside this hook.
const useAxesFeed: ((index: number) => AxesState | undefined) | undefined = findModuleExport(
  (value: unknown) =>
    typeof value === 'function' && value.toString().includes('useControllerAxesFeed'),
);
interface ButtonState {
  bLeftBumper?: boolean;
  bRightBumper?: boolean;
  bLeftStickClick?: boolean;
  bRightStickClick?: boolean;
  bRightTrigger?: boolean;
  bLeftTrigger?: boolean;
}
const useButtonFeed: ((index: number) => ButtonState | undefined) | undefined = findModuleExport(
  (value: unknown) =>
    typeof value === 'function' && value.toString().includes('useControllerButtonFeed'),
);

const fullscreenWeb = callable<[url: string, title: string], void>('toggle_web_fullscreen');
const sendWebSpace = callable<[url: string, title: string], void>('send_web_space');
const zoomWeb = callable<[url: string, action: ZoomAction, title: string], unknown>(
  'zoom_web_page',
);
const zoomReader = callable<[path: string, action: ZoomAction], void>('zoom_reader');

const ReaderButtons = ({
  controllerIndex,
  path,
  fullscreen,
  onFullscreenToggle,
}: {
  controllerIndex: number;
  path?: string;
  fullscreen: boolean;
  onFullscreenToggle?: () => void;
}) => {
  const buttons = useButtonFeed!(controllerIndex);
  // Keys held while opening/changing the reader must be released first.
  const previous = useRef([true, true, true, true, true, true]);
  const inFlight = useRef(false);
  const smaller = buttons?.bLeftBumper;
  const larger = buttons?.bRightBumper;
  const reset = buttons?.bLeftStickClick;
  const full = buttons?.bRightStickClick;
  const toggle = buttons?.bRightTrigger;
  const playback = buttons?.bLeftTrigger;
  useEffect(() => {
    const states = [smaller, larger, reset, full, toggle, playback];
    const edges = states.map((pressed, index) => {
      if (pressed === undefined) return false;
      const trigger = pressed && !previous.current[index];
      previous.current[index] = pressed;
      return trigger;
    });
    const index = edges.findIndex(Boolean);
    if (index === 4) {
      onFullscreenToggle?.();
      return;
    }
    if (
      index < 0 ||
      inFlight.current ||
      (index === 3 && (path || !fullscreen)) ||
      (index === 5 && path)
    )
      return;
    const page = path ? undefined : webPage();
    if (!path && !page) return;
    const action = (['smaller', 'larger', 'default'] as const)[index];
    inFlight.current = true;
    const command =
      index === 5
        ? sendWebSpace(page!.url, page!.title)
        : index === 3
          ? fullscreenWeb(page!.url, page!.title)
          : path
            ? zoomReader(path, action)
            : zoomWeb(page!.url, action, page!.title);
    void command
      .catch((error: unknown) =>
        toaster.toast({
          title:
            index === 5
              ? '播放暂停快捷键发送失败'
              : index === 3
                ? '视频全屏快捷键发送失败'
                : '缩放快捷键执行失败',
          body: String(error),
        }),
      )
      .finally(() => {
        inFlight.current = false;
      });
  }, [smaller, larger, reset, full, toggle, playback, path, fullscreen, onFullscreenToggle]);
  return null;
};

const setMotion = callable<[path: string, x: number, y: number], void>('set_reader_motion');
const scrollWebPage = callable<
  [url: string, x: number, y: number, width: number, height: number, title: string],
  void
>('scroll_web_page');
const releaseWebScroll = callable<[], void>('release_web_scroll');

const webPage = () => {
  const view = (
    window as unknown as {
      portal?: {
        URL: string;
        Title?: string;
        GetBrowser(): { GetBounds(): { width: number; height: number } };
      };
    }
  ).portal;
  return view && { url: view.URL, title: view.Title || '', ...view.GetBrowser().GetBounds() };
};

export const stickVelocity = (value: number): number => {
  if (!Number.isFinite(value) || Math.abs(value) <= 0.18) return 0;
  return Math.sign(value) * Math.min(1, (Math.abs(value) - 0.18) / 0.82);
};

const NativeReaderInput = ({
  path,
  controllerIndex,
}: {
  path?: string;
  controllerIndex: number;
}) => {
  const axes = useAxesFeed!(controllerIndex);
  const latest = useRef(axes);
  useEffect(() => {
    latest.current = axes;
  }, [axes]);

  useEffect(() => {
    let moved = false;
    let inFlight = false;
    let reportedError = false;
    const timer = setInterval(() => {
      const x = stickVelocity(latest.current?.RightJoystick?.x ?? 0);
      // Steam reports positive Y upwards; DOM scrollTop grows downwards.
      const y = -stickVelocity(latest.current?.RightJoystick?.y ?? 0);
      if (inFlight || (!x && !y && !moved)) return;
      moved = !!(x || y);
      const page = path ? undefined : webPage();
      if (!path && (!page || (!x && !y))) return;
      inFlight = true;
      const motion = path
        ? setMotion(path, x, y)
        : scrollWebPage(page!.url, x, y, page!.width, page!.height, page!.title);
      void motion
        .catch((error: unknown) => {
          if (!path && !reportedError) {
            reportedError = true;
            toaster.toast({ title: '网页滚动暂不可用', body: String(error) });
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, 100);
    return () => {
      clearInterval(timer);
      if (path) void setMotion(path, 0, 0).catch(() => undefined);
      else void releaseWebScroll().catch(() => undefined);
    };
  }, [path, controllerIndex]);

  return null;
};

export const ReaderInput = ({
  path,
  fullscreen = false,
  onFullscreenToggle,
}: {
  path?: string;
  fullscreen?: boolean;
  onFullscreenToggle?: () => void;
}) => {
  const [controllerIndex, setControllerIndex] = useState(getActiveControllerIndex);
  useEffect(() => {
    const timer = setInterval(() => setControllerIndex(getActiveControllerIndex()), 250);
    return () => clearInterval(timer);
  }, []);

  if (controllerIndex === undefined) return null;
  return (
    <>
      {useAxesFeed && <NativeReaderInput path={path} controllerIndex={controllerIndex} />}
      {useButtonFeed && (
        <ReaderButtons
          key={`${controllerIndex}:${path ?? 'web'}`}
          controllerIndex={controllerIndex}
          path={path}
          fullscreen={fullscreen}
          onFullscreenToggle={onFullscreenToggle}
        />
      )}
    </>
  );
};
