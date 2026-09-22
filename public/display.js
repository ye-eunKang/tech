(() => {
  const qs = new URLSearchParams(location.search);
  const fishId = qs.get('fish') || '';
  const video = document.getElementById('video');
  const waiting = document.getElementById('waiting');
  const sceneLabel = document.getElementById('sceneLabel');
  const title = document.getElementById('title');
  const caption = document.getElementById('caption');
  const connection = document.getElementById('connection');
  const toast = document.getElementById('toast');
  let scene = 1;
  let currentFish = fishId || 'fish01';
  let video2ShouldPlay = false;

  const videos = {
    1: 'assets/#1_walk.mp4',
    2: 'assets/#4_water',
    3: 'assets/#4_main1_low.mp4',
    4: 'assets/#4_main2_low.mp4'
  };

  const socket = new FishSocket({
    role: 'display',
    fishId,
    onStatus(status, delay) {
      if (status === 'open') connection.textContent = '연결됨';
      else if (status === 'reconnecting') connection.textContent = `재연결 중… ${Math.round(delay / 1000)}초`;
      else if (status === 'error') connection.textContent = '연결 오류';
      else connection.textContent = '서버 연결 중…';
    },
    onMessage: handleMessage
  });

  function send(type, extra = {}, options = {}) {
    socket.send({ type, fishId: currentFish, ...extra }, options);
  }

  function pop(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(pop.t);
    pop.t = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  async function setScene(n) {
    scene = n;
    waiting.classList.remove('show');
    video.loop = n === 1;
    video.src = videos[n];
    video.currentTime = 0;
    const meta = {
      1:['기본 영상 ①','바다는 기다리고 있습니다.','NFC를 태그하면 다음 장면이 시작됩니다.'],
      2:['영상 ②','기울임이 시간을 움직입니다.','휴대폰을 기울이는 동안 장면이 재생됩니다.'],
      3:['영상 ③','조금 더 깊은 곳으로.','장면이 끝나면 휴대폰에서 미니게임이 시작됩니다.'],
      4:['영상 ④','마지막 장면입니다.','영상이 끝나면 휴대폰을 수평으로 맞춰 주세요.']
    }[n];
    sceneLabel.textContent = meta[0];
    title.textContent = meta[1];
    caption.textContent = meta[2];
    try {
      if (n === 1 || n === 3 || n === 4) await video.play();
      if (n === 2) video.pause();
    } catch (_) {}
  }

  function waitingScreen(kind) {
    waiting.classList.add('show');
    if (kind === 'game') {
      document.getElementById('waitTitle').textContent = '미니게임 진행 중';
      document.getElementById('waitSub').textContent = '휴대폰에서 물고기를 찾아 주세요.';
    }
  }

  async function handleMessage(msg) {
    if (msg.fishId) currentFish = msg.fishId;
    switch (msg.type) {
      case 'SESSION_START':
        pop(`${currentFish} 세션 시작`);
        await setScene(2);
        break;
      case 'TILT':
        if (scene !== 2) break;
        video.playbackRate = Math.max(.55, Math.min(2, Math.abs(msg.gamma || 0) / 22));
        video2ShouldPlay = Boolean(msg.playing);
        if (video2ShouldPlay && video.paused) video.play().catch(()=>{});
        if (!video2ShouldPlay && !video.paused) video.pause();
        break;
      case 'TILT_COMPLETE':
        await setScene(3);
        break;
      case 'GAME_COMPLETE':
        await setScene(4);
        break;
      case 'SPAWN_FISH':
        pop(`${currentFish} 등장`);
        title.textContent = '물고기가 바다에 도착했습니다.';
        caption.textContent = `${currentFish} 신호가 TouchDesigner로 전달되었습니다.`;
        break;
    }
  }

  video.addEventListener('ended', () => {
    if (scene === 2 && video2ShouldPlay) return;
    if (scene === 3) {
      send('VIDEO3_ENDED');
      waitingScreen('game');
    }
    if (scene === 4) {
      send('VIDEO4_ENDED');
      title.textContent = '휴대폰을 수평으로 맞춰 주세요.';
      caption.textContent = '2초 동안 안정적으로 유지하면 물고기가 나타납니다.';
    }
  });

  document.getElementById('audioBtn').addEventListener('click', async (e) => {
    video.muted = !video.muted;
    e.currentTarget.textContent = video.muted ? '소리 켜기' : '소리 끄기';
    if (scene === 1 || scene === 3 || scene === 4 || video2ShouldPlay) video.play().catch(()=>{});
  });

  setScene(1);
})();
