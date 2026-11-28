import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  releaseWebScrollMock,
  scrollWebPageMock,
  sendWebSpaceMock,
  setReaderMotionMock,
  toggleWebFullscreenMock,
  zoomReaderMock,
  zoomWebPageMock,
} from '../__mocks__/decky-api';
import { getActiveControllerIndex } from '../lib/controller';

const { useAxesMock, useButtonsMock } = vi.hoisted(() => ({
  useAxesMock: vi.fn(),
  useButtonsMock: vi.fn(),
}));
vi.mock('@decky/ui', () => ({
  findModuleExport: (predicate: (value: unknown) => boolean) =>
    predicate(function useControllerButtonFeed() {}) ? useButtonsMock : useAxesMock,
}));
vi.mock('../lib/controller', () => ({ getActiveControllerIndex: vi.fn() }));

import { ReaderInput, stickVelocity } from './reader-input';

describe('right stick reader input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(getActiveControllerIndex).mockReturnValue(15);
    useButtonsMock.mockReturnValue({
      bRightStickClick: false,
      bLeftBumper: false,
      bRightBumper: false,
      bLeftStickClick: false,
      bLeftTrigger: false,
      bRightTrigger: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has a dead zone and bounded proportional velocity', () => {
    expect(stickVelocity(0.1)).toBe(0);
    expect(stickVelocity(Number.NaN)).toBe(0);
    expect(stickVelocity(1)).toBe(1);
    expect(stickVelocity(-2)).toBe(-1);
    expect(stickVelocity(0.59)).toBeCloseTo(0.5);
  });

  it('toggles on each R2 press, requiring release and ignoring holds', () => {
    const change = vi.fn();
    useButtonsMock.mockReturnValue({ bRightTrigger: true });
    const { rerender, unmount } = render(<ReaderInput onFullscreenToggle={change} />);
    expect(change).not.toHaveBeenCalled();
    for (let press = 0; press < 2; press++) {
      useButtonsMock.mockReturnValue({ bRightTrigger: false, bLeftTrigger: false });
      rerender(<ReaderInput onFullscreenToggle={change} />);
      useButtonsMock.mockReturnValue({ bRightTrigger: true });
      rerender(<ReaderInput onFullscreenToggle={change} />);
      expect(change).toHaveBeenCalledTimes(press + 1);
      rerender(<ReaderInput onFullscreenToggle={change} />);
    }
    expect(change).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('sends one Space per L2 press to the current page, leaving window size and video fullscreen alone', async () => {
    const change = vi.fn();
    const page = {
      URL: 'https://video.example/episode1',
      Title: '第一集',
      GetBrowser: () => ({ GetBounds: () => ({ width: 854, height: 534 }) }),
    };
    Object.assign(window, { portal: page });
    useButtonsMock.mockReturnValue({ bLeftTrigger: true });
    const { rerender, unmount } = render(<ReaderInput onFullscreenToggle={change} />);
    expect(sendWebSpaceMock).not.toHaveBeenCalled();
    for (let press = 0; press < 2; press++) {
      useButtonsMock.mockReturnValue({ bLeftTrigger: false });
      rerender(<ReaderInput onFullscreenToggle={change} />);
      useButtonsMock.mockReturnValue({ bLeftTrigger: true });
      await act(async () => rerender(<ReaderInput onFullscreenToggle={change} />));
      expect(sendWebSpaceMock).toHaveBeenCalledTimes(press + 1);
      expect(sendWebSpaceMock).toHaveBeenLastCalledWith(page.URL, page.Title);
      rerender(<ReaderInput onFullscreenToggle={change} />);
      expect(sendWebSpaceMock).toHaveBeenCalledTimes(press + 1);
      page.URL = 'https://video.example/episode2';
      page.Title = '第二集';
    }
    useButtonsMock.mockReturnValue({ bLeftTrigger: false });
    rerender(<ReaderInput path="/tmp/guide.JPG" onFullscreenToggle={change} />);
    useButtonsMock.mockReturnValue({ bLeftTrigger: true });
    await act(async () =>
      rerender(<ReaderInput path="/tmp/guide.JPG" onFullscreenToggle={change} />),
    );
    expect(sendWebSpaceMock).toHaveBeenCalledTimes(2);
    expect(change).not.toHaveBeenCalled();
    expect(toggleWebFullscreenMock).not.toHaveBeenCalled();
    unmount();
  });

  it('sends downward motion, stops on release and unregisters polling when hidden', async () => {
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: -1 } });
    const { rerender, unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(useAxesMock).toHaveBeenCalledWith(15);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(setReaderMotionMock).toHaveBeenLastCalledWith('/tmp/guide.JPG', 0, 1);
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    rerender(<ReaderInput path="/tmp/guide.JPG" />);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(setReaderMotionMock).toHaveBeenLastCalledWith('/tmp/guide.JPG', 0, -0);
    unmount();
    expect(setReaderMotionMock).toHaveBeenLastCalledWith('/tmp/guide.JPG', 0, 0);
    const calls = setReaderMotionMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(setReaderMotionMock).toHaveBeenCalledTimes(calls);
  });

  it('does not send idle motion repeatedly', async () => {
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0.01, y: 0 } });
    const { unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(setReaderMotionMock).not.toHaveBeenCalled();
    unmount();
  });

  it('scrolls the current web page and releases it when hidden', async () => {
    Object.assign(window, {
      portal: {
        URL: 'https://guide.example/chapter',
        Title: '第二集',
        GetBrowser: () => ({ GetBounds: () => ({ width: 506, height: 534 }) }),
      },
    });
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: -1 } });
    const { rerender, unmount } = render(<ReaderInput />);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollWebPageMock).toHaveBeenLastCalledWith(
      'https://guide.example/chapter',
      0,
      1,
      506,
      534,
      '第二集',
    );
    expect(setReaderMotionMock).not.toHaveBeenCalled();
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    rerender(<ReaderInput />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(scrollWebPageMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(releaseWebScrollMock).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(scrollWebPageMock).toHaveBeenCalledTimes(1);
  });

  it('switches the raw feed when Steam changes its active controller', async () => {
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    const { unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(useAxesMock).toHaveBeenLastCalledWith(15);
    vi.mocked(getActiveControllerIndex).mockReturnValue(3);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(useAxesMock).toHaveBeenLastCalledWith(3);
    unmount();
  });

  it('does not subscribe to a made-up device when no controller exists', () => {
    vi.mocked(getActiveControllerIndex).mockReturnValue(undefined);
    const { unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(useAxesMock).not.toHaveBeenCalled();
    unmount();
  });

  it('sends F once per R3 press, ignores a held stick on opening, and unsubscribes when hidden', async () => {
    Object.assign(window, {
      portal: {
        URL: 'https://video.example/',
        Title: '视频第二集',
        GetBrowser: () => ({ GetBounds: () => ({ width: 506, height: 500 }) }),
      },
    });
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    useButtonsMock.mockReturnValue({ bRightStickClick: true });
    const { rerender, unmount } = render(<ReaderInput fullscreen />);
    expect(useButtonsMock).toHaveBeenCalledWith(15);
    expect(toggleWebFullscreenMock).not.toHaveBeenCalled();
    useButtonsMock.mockReturnValue({ bRightStickClick: false });
    rerender(<ReaderInput fullscreen />);
    useButtonsMock.mockReturnValue({ bRightStickClick: true });
    await act(async () => rerender(<ReaderInput fullscreen />));
    expect(toggleWebFullscreenMock).toHaveBeenCalledExactlyOnceWith(
      'https://video.example/',
      '视频第二集',
    );
    rerender(<ReaderInput fullscreen />);
    expect(toggleWebFullscreenMock).toHaveBeenCalledTimes(1);
    useButtonsMock.mockReturnValue({ bRightStickClick: false });
    rerender(<ReaderInput fullscreen />);
    useButtonsMock.mockReturnValue({ bRightStickClick: true });
    await act(async () => rerender(<ReaderInput fullscreen />));
    expect(toggleWebFullscreenMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('ignores R3 when disabled or viewing local files', async () => {
    const { rerender, unmount } = render(<ReaderInput />);
    useButtonsMock.mockReturnValue({ bRightStickClick: true });
    await act(async () => rerender(<ReaderInput />));
    expect(toggleWebFullscreenMock).not.toHaveBeenCalled();
    useButtonsMock.mockReturnValue({ bRightStickClick: false });
    rerender(<ReaderInput path="/tmp/guide.JPG" fullscreen />);
    useButtonsMock.mockReturnValue({ bRightStickClick: true });
    await act(async () => rerender(<ReaderInput path="/tmp/guide.JPG" fullscreen />));
    expect(toggleWebFullscreenMock).not.toHaveBeenCalled();
    unmount();
  });

  it.each([undefined, '/tmp/guide.JPG'])('maps L1/R1/L3 to zoom buttons for %s', async (path) => {
    Object.assign(window, {
      portal: {
        URL: 'https://guide.example/',
        Title: '攻略',
        GetBrowser: () => ({ GetBounds: () => ({ width: 506, height: 534 }) }),
      },
    });
    const { rerender, unmount } = render(<ReaderInput path={path} />);
    for (const [button, action] of [
      ['bLeftBumper', 'smaller'],
      ['bRightBumper', 'larger'],
      ['bLeftStickClick', 'default'],
    ]) {
      useButtonsMock.mockReturnValue({ [button]: true });
      await act(async () => rerender(<ReaderInput path={path} />));
      if (path) expect(zoomReaderMock).toHaveBeenLastCalledWith(path, action);
      else
        expect(zoomWebPageMock).toHaveBeenLastCalledWith('https://guide.example/', action, '攻略');
      rerender(<ReaderInput path={path} />);
      useButtonsMock.mockReturnValue({ [button]: false });
      rerender(<ReaderInput path={path} />);
    }
    expect(path ? zoomReaderMock : zoomWebPageMock).toHaveBeenCalledTimes(3);
    expect(path ? zoomWebPageMock : zoomReaderMock).not.toHaveBeenCalled();
    unmount();
  });

  it('requires release after opening or changing controller, and ignores presses while pending', async () => {
    useButtonsMock.mockReturnValue({ bLeftBumper: true });
    const { rerender, unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(zoomReaderMock).not.toHaveBeenCalled();
    let finish!: () => void;
    zoomReaderMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    useButtonsMock.mockReturnValue({ bLeftBumper: false });
    rerender(<ReaderInput path="/tmp/guide.JPG" />);
    useButtonsMock.mockReturnValue({ bLeftBumper: true });
    rerender(<ReaderInput path="/tmp/guide.JPG" />);
    useButtonsMock.mockReturnValue({ bLeftBumper: false });
    rerender(<ReaderInput path="/tmp/guide.JPG" />);
    useButtonsMock.mockReturnValue({ bLeftBumper: true });
    rerender(<ReaderInput path="/tmp/guide.JPG" />);
    expect(zoomReaderMock).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    vi.mocked(getActiveControllerIndex).mockReturnValue(3);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(useButtonsMock).toHaveBeenLastCalledWith(3);
    expect(zoomReaderMock).toHaveBeenCalledTimes(1);
    unmount();
  });
});
