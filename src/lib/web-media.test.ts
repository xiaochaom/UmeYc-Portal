import source from '../../assets/web-media.js?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const media = (action: string): Promise<void> =>
  window.eval(source.replace('__PORTAL_MEDIA_ACTION__', JSON.stringify(action)));

describe('explicit fullscreen media control', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="video-js"><video></video><video></video></div>';
    delete (window as unknown as { __portalMediaState?: unknown }).__portalMediaState;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('pauses once and resumes only media that was playing before hiding', async () => {
    const [playing, paused] = [...document.querySelectorAll('video')];
    let isPaused = false;
    vi.spyOn(playing, 'paused', 'get').mockImplementation(() => isPaused);
    vi.spyOn(paused, 'paused', 'get').mockReturnValue(true);
    const pause = vi.spyOn(playing, 'pause').mockImplementation(() => {
      isPaused = true;
    });
    const play = vi.spyOn(playing, 'play').mockImplementation(async () => {
      isPaused = false;
    });
    const pausedPlay = vi.spyOn(paused, 'play');
    await media('pause');
    await media('pause');
    expect(pause).toHaveBeenCalledOnce();
    await media('resume');
    await media('resume');
    expect(play).toHaveBeenCalledOnce();
    expect(pausedPlay).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves the video fullscreen state %s during playback control',
    async (enabled) => {
      const player = document.querySelector('div')!;
      const enter = vi.fn(async () => undefined);
      const exit = vi.fn(async () => undefined);
      Object.assign(player, { requestFullscreen: enter });
      Object.assign(document, { exitFullscreen: exit });
      vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(enabled ? player : null);
      await media('pause');
      await media('resume');
      expect(document.fullscreenElement).toBe(enabled ? player : null);
      expect(enter).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    },
  );

  it('does not resume removed media or fail on a page with no video', async () => {
    const video = document.querySelector('video')!;
    vi.spyOn(video, 'paused', 'get').mockReturnValue(false);
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(video, 'play');
    await media('pause');
    document.body.innerHTML = '';
    await media('resume');
    expect(play).not.toHaveBeenCalled();
    await media('pause');
    await media('resume');
  });
});
