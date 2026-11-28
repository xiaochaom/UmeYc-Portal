(async () => {
  const action = __PORTAL_MEDIA_ACTION__;
  const videos = [...document.querySelectorAll('video, audio')];
  const state = (window.__portalMediaState ??= { paused: new Set() });
  if (action === 'pause') {
    for (const media of videos) {
      if (!media.paused && !media.ended) {
        state.paused.add(media);
        media.pause();
      }
    }
    return;
  }
  if (action === 'resume') {
    for (const media of [...state.paused]) {
      if (media.isConnected && !media.ended) await media.play();
      state.paused.delete(media);
    }
    return;
  }
})()
