(() => {
  const qs = new URLSearchParams(location.search);
  const fishId = qs.get('fish') || '';

  const videoA = document.getElementById('videoA');
  const videoB = document.getElementById('videoB');
  const waiting = document.getElementById('waiting');
  const sceneLabel = document.getElementById('sceneLabel');
  const title = document.getElementById('title');
  const caption = document.getElementById('caption');
  const connection = document.getElementById('connection');
  const toast = document.getElementById('toast');

  let activeVideo = videoA;
  let standbyVideo = videoB;
  let scene = 1;
  let currentFish = fishId || 'fish01';
  let video2ShouldPlay = false;
  let resetTimer = null;
  let transitionToken = 0;
  let soundEnabled = false;

  const videos = {
    1: 'assets/1_walk.mp4',
    2: 'assets/4_water.mp4',
    3: 'assets/4_main1_low.mp4',
    4: 'assets/4_main2_low.mp4'
  };

  const preloaders = new Map();

  function preloadScene(n) {
    if (!videos[n] || preloaders.has(n)) return;

    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = videos[n];
    v.load();

    preloaders.set(n, v);
  }

  function waitForLoadedFrame(video, timeout = 5000) {
    if (video.readyState >= 2) return Promise.resolve();

    return new Promise(resolve => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', finish);
        video.removeEventListener('canplay', finish);
        video.removeEventListener('error', finish);
      };

      const timer = setTimeout(finish, timeout);

      video.addEventListener('loadeddata', finish, { once: true });
      video.addEventListener('canplay', finish, { once: true });
      video.addEventListener('error', finish, { once: true });
    });
  }

  function waitForSeek(video, timeout = 1500) {
    return new Promise(resolve => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
      };

      const timer = setTimeout(finish, timeout);

      video.addEventListener('seeked', finish, { once: true });
    });
  }

  function waitForPaintedFrame(video, timeout = 1200) {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      return new Promise(resolve => setTimeout(resolve, 80));
    }

    return new Promise(resolve => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(finish, timeout);
      video.requestVideoFrameCallback(finish);
    });
  }

  async function prepareVideo(video, n) {
    const src = videos[n];

    video.pause();
    video.loop = n === 1;
    video.playbackRate = 1;
    video.muted = !soundEnabled;

    if (video.getAttribute('src') !== src) {
      video.src = src;
      video.load();
    }

    await waitForLoadedFrame(video);

    // 2번 영상은 기울이기 전에도 검은 화면 대신 실제 첫 장면이 보이도록
    // 아주 짧게 앞으로 이동한 프레임을 준비한다.
    if (n === 2 && Number.isFinite(video.duration) && video.duration > 0.12) {
      const target = Math.min(0.08, Math.max(0, video.duration - 0.04));

      try {
        if (Math.abs(video.currentTime - target) > 0.02) {
          video.currentTime = target;
          await waitForSeek(video);
        }
      } catch (_) {}

      try {
        await video.play();
        await waitForPaintedFrame(video);
        video.pause();
      } catch (_) {
        video.pause();
      }
    } else {
      try {
        video.currentTime = 0;
      } catch (_) {}

      try {
        await video.play();
        await waitForPaintedFrame(video);
      } catch (_) {}
    }
  }

  const socket = new FishSocket({
    role: 'display',
    fishId,

    onStatus(status, delay) {
      if (!connection) return;

      if (status === 'open') connection.textContent = '연결됨';
      else if (status === 'reconnecting') {
        connection.textContent = `재연결 중… ${Math.round(delay / 1000)}초`;
      } else if (status === 'error') {
        connection.textContent = '연결 오류';
      } else {
        connection.textContent = '서버 연결 중…';
      }
    },

    onMessage: handleMessage
  });

  function send(type, extra = {}, options = {}) {
    socket.send({ type, fishId: currentFish, ...extra }, options);
  }

  function pop(text) {
    if (!toast) return;

    toast.textContent = text;
    toast.classList.add('show');

    clearTimeout(pop.t);
    pop.t = setTimeout(() => {
      toast.classList.remove('show');
    }, 1200);
  }

  function updateMeta(n) {
    const meta = {
      1: [
        '기본 영상 ①',
        '바다는 기다리고 있습니다.',
        'NFC를 태그하면 다음 장면이 시작됩니다.'
      ],
      2: [
        '영상 ②',
        '기울임이 시간을 움직입니다.',
        '휴대폰을 기울이는 동안 장면이 재생됩니다.'
      ],
      3: [
        '영상 ③',
        '조금 더 깊은 곳으로.',
        '장면이 끝나면 휴대폰에서 미니게임이 시작됩니다.'
      ],
      4: [
        '영상 ④',
        '마지막 장면입니다.',
        '영상이 끝나면 휴대폰을 수평으로 맞춰 주세요.'
      ]
    }[n];

    if (sceneLabel) sceneLabel.textContent = meta[0];
    if (title) title.textContent = meta[1];
    if (caption) caption.textContent = meta[2];
  }

  async function setScene(n) {
    const myToken = ++transitionToken;
    const oldVideo = activeVideo;
    const nextVideo = standbyVideo;

    scene = n;
    video2ShouldPlay = false;

    if (waiting) waiting.classList.remove('show');

    updateMeta(n);
    await prepareVideo(nextVideo, n);

    if (myToken !== transitionToken) return;

    // 다음 영상이 실제 프레임까지 준비된 뒤에만 화면을 넘긴다.
    nextVideo.classList.add('active');
    oldVideo.classList.remove('active');

    activeVideo = nextVideo;
    standbyVideo = oldVideo;

    setTimeout(() => {
      if (standbyVideo !== activeVideo) {
        standbyVideo.pause();
      }
    }, 260);

    // 다음 장면을 미리 받아 둔다.
    if (n < 4) preloadScene(n + 1);
  }

  function scheduleReset() {
    clearTimeout(resetTimer);

    resetTimer = setTimeout(() => {
      setScene(1);
    }, 3000);
  }

  function waitingScreen(kind) {
    if (!waiting) return;

    waiting.classList.add('show');

    if (kind === 'game') {
      const waitTitle = document.getElementById('waitTitle');
      const waitSub = document.getElementById('waitSub');

      if (waitTitle) waitTitle.textContent = '미니게임 진행 중';
      if (waitSub) waitSub.textContent = '휴대폰에서 물고기를 찾아 주세요.';
    }
  }

  async function handleMessage(msg) {
    if (msg.fishId) currentFish = msg.fishId;

    switch (msg.type) {
      case 'SESSION_START':
        clearTimeout(resetTimer);
        pop(`${currentFish} 세션 시작`);
        await setScene(2);
        break;

      case 'TILT':
        if (scene !== 2) break;

        activeVideo.playbackRate = Math.max(
          0.55,
          Math.min(2, Math.abs(msg.gamma || 0) / 22)
        );

        video2ShouldPlay = Boolean(msg.playing);

        if (video2ShouldPlay && activeVideo.paused) {
          activeVideo.play().catch(() => {});
        }

        if (!video2ShouldPlay && !activeVideo.paused) {
          activeVideo.pause();
        }
        break;

      case 'TILT_COMPLETE':
        await setScene(3);
        break;

      case 'GAME_COMPLETE':
        await setScene(4);
        break;

      case 'SPAWN_FISH':
        pop(`${currentFish} 등장`);

        if (title) title.textContent = '물고기가 바다에 도착했습니다.';
        if (caption) {
          caption.textContent =
            `${currentFish} 신호가 TouchDesigner로 전달되었습니다.`;
        }

        scheduleReset();
        break;

      case 'RESET_EXPERIENCE':
        clearTimeout(resetTimer);
        await setScene(1);
        break;
    }
  }

  function onEnded(event) {
    if (event.currentTarget !== activeVideo) return;

    if (scene === 2 && video2ShouldPlay) return;

    if (scene === 3) {
      send('VIDEO3_ENDED');
      waitingScreen('game');
    }

    if (scene === 4) {
      send('VIDEO4_ENDED');

      if (title) title.textContent = '휴대폰을 수평으로 맞춰 주세요.';
      if (caption) {
        caption.textContent =
          '2초 동안 안정적으로 유지하면 물고기가 나타납니다.';
      }
    }
  }

  videoA.addEventListener('ended', onEnded);
  videoB.addEventListener('ended', onEnded);

  const audioBtn = document.getElementById('audioBtn');

  if (audioBtn) {
    audioBtn.addEventListener('click', e => {
      soundEnabled = !soundEnabled;
      videoA.muted = !soundEnabled;
      videoB.muted = !soundEnabled;

      e.currentTarget.textContent =
        soundEnabled ? '소리 끄기' : '소리 켜기';
    });
  }

  // 시작하자마자 2번 영상을 미리 내려받아 NFC 태그 직후 바로 보이게 한다.
  preloadScene(2);
  setScene(1);
})();
