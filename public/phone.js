(() => {
  const qs = new URLSearchParams(location.search);
  const fishId = qs.get('fish') || 'fish01';
  const debug = qs.get('debug') === '1';

  const TILT_PLAY_DEG = 12;
  const TILT_TARGET_DEG = 30;
  const TILT_HOLD_MS = 1500;
  const LEVEL_TOLERANCE = 5;
  const LEVEL_HOLD_MS = 2000;
  const SEND_INTERVAL_MS = 50;
  const SMOOTHING = 0.18;

  let state = 'READY';
  let beta = 0;
  let gamma = 0;
  let smoothBeta = 0;
  let smoothGamma = 0;
  let tiltHoldStart = null;
  let levelHoldStart = null;
  let lastSend = 0;
  let spawnSent = false;
  let score = 0;
  let sensorAttached = false;
  let sessionStarted = false;
  let resetTimer = null;

  const $ = id => document.getElementById(id);
  const conn = $('conn');
  const stages = [...document.querySelectorAll('.stage')];

  function show(name) {
    state = name;
    stages.forEach(el => el.classList.remove('active'));

    const map = {
      READY: 'stage-ready',
      TILT: 'stage-tilt',
      WAIT_GAME: 'stage-wait-game',
      GAME: 'stage-game',
      WAIT_LEVEL: 'stage-wait-level',
      LEVEL: 'stage-level',
      COMPLETE: 'stage-complete',
      ERROR: 'stage-error'
    };

    const target = $(map[name]);
    if (target) target.classList.add('active');
  }

  const socket = new FishSocket({
    role: 'phone',
    fishId,

    onStatus(status, delay) {
      if (!conn) return;

      if (status === 'open') conn.textContent = '서버 연결됨';
      else if (status === 'reconnecting') conn.textContent = `재연결 중… ${Math.round(delay / 1000)}초`;
      else if (status === 'error') conn.textContent = '연결 오류';
      else conn.textContent = '서버 연결 중…';
    },

    onOpen() {
      if (!sessionStarted) {
        sessionStarted = true;
        send('SESSION_START');
      }
    },

    onMessage(msg) {
      if (msg.type === 'VIDEO3_ENDED' && state === 'WAIT_GAME') {
        startGame();
      }

      if (msg.type === 'VIDEO4_ENDED' && state === 'WAIT_LEVEL') {
        levelHoldStart = null;
        show('LEVEL');
      }
    }
  });

  function send(type, extra = {}, options = {}) {
    socket.send({ type, fishId, ...extra }, options);
  }

  async function requestSensorPermission() {
    try {
      if (debug) {
        show('TILT');
        return;
      }

      if (typeof DeviceOrientationEvent === 'undefined') {
        throw new Error('이 브라우저에서는 기울기 센서를 찾을 수 없습니다.');
      }

      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const result = await DeviceOrientationEvent.requestPermission();

        if (result !== 'granted') {
          throw new Error('기울기 센서 권한이 허용되지 않았습니다.');
        }
      }

      attachSensor();
      show('TILT');
    } catch (err) {
      const errorText = $('errorText');
      if (errorText) {
        errorText.textContent =
          `${err.message} Safari/브라우저 설정에서 동작 및 방향 접근을 확인한 뒤 다시 시도해 주세요.`;
      }
      show('ERROR');
    }
  }

  function attachSensor() {
    if (sensorAttached) return;

    window.addEventListener('deviceorientation', e => {
      if (typeof e.beta === 'number') beta = e.beta;
      if (typeof e.gamma === 'number') gamma = e.gamma;

      ingest(beta, gamma, performance.now());
    });

    sensorAttached = true;
  }

  function ingest(rawBeta, rawGamma, now) {
    smoothBeta += (rawBeta - smoothBeta) * SMOOTHING;
    smoothGamma += (rawGamma - smoothGamma) * SMOOTHING;

    if (state === 'TILT') {
      const gammaText = $('gammaText');
      const tiltHoldText = $('tiltHoldText');
      const tiltMeter = $('tiltMeter');

      if (gammaText) gammaText.textContent = `${smoothGamma.toFixed(1)}°`;

      const target = smoothGamma >= TILT_TARGET_DEG;

      if (target) {
        if (tiltHoldStart == null) tiltHoldStart = now;
      } else {
        tiltHoldStart = null;
      }

      const held =
        tiltHoldStart == null
          ? 0
          : Math.min(TILT_HOLD_MS, now - tiltHoldStart);

      if (tiltHoldText) {
        tiltHoldText.textContent = `${(held / 1000).toFixed(1)}s`;
      }

      if (tiltMeter) {
        tiltMeter.style.width =
          `${Math.max(0, Math.min(100, (held / TILT_HOLD_MS) * 100))}%`;
      }

      if (now - lastSend >= SEND_INTERVAL_MS) {
        lastSend = now;

        send(
          'TILT',
          {
            beta: +smoothBeta.toFixed(2),
            gamma: +smoothGamma.toFixed(2),
            playing: smoothGamma >= TILT_PLAY_DEG
          },
          { volatile: true }
        );
      }

      if (held >= TILT_HOLD_MS) {
        tiltHoldStart = null;

        send('TILT_COMPLETE', {
          beta: +smoothBeta.toFixed(2),
          gamma: +smoothGamma.toFixed(2)
        });

        show('WAIT_GAME');
      }
    }

    if (state === 'LEVEL') {
      const betaText = $('betaText');
      const levelGammaText = $('levelGammaText');
      const levelMeter = $('levelMeter');
      const levelHoldText = $('levelHoldText');

      if (betaText) betaText.textContent = `${smoothBeta.toFixed(1)}°`;
      if (levelGammaText) {
        levelGammaText.textContent = `${smoothGamma.toFixed(1)}°`;
      }

      const level =
        Math.abs(smoothBeta) <= LEVEL_TOLERANCE &&
        Math.abs(smoothGamma) <= LEVEL_TOLERANCE;

      if (level) {
        if (levelHoldStart == null) levelHoldStart = now;
      } else {
        levelHoldStart = null;
      }

      const held =
        levelHoldStart == null
          ? 0
          : Math.min(LEVEL_HOLD_MS, now - levelHoldStart);

      if (levelMeter) {
        levelMeter.style.width =
          `${Math.max(0, Math.min(100, (held / LEVEL_HOLD_MS) * 100))}%`;
      }

      if (levelHoldText) {
        levelHoldText.textContent =
          `${(held / 1000).toFixed(1)} / ${(LEVEL_HOLD_MS / 1000).toFixed(1)}초`;
      }

      if (held >= LEVEL_HOLD_MS && !spawnSent) {
        spawnSent = true;

        send('SPAWN_FISH', {
          beta: +smoothBeta.toFixed(2),
          gamma: +smoothGamma.toFixed(2)
        });

        const completeFishId = $('completeFishId');
        if (completeFishId) completeFishId.textContent = fishId;

        show('COMPLETE');

        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          send('RESET_EXPERIENCE');
          resetPhone();
        }, 3000);
      }
    }
  }

  function resetPhone() {
    state = 'READY';

    beta = 0;
    gamma = 0;
    smoothBeta = 0;
    smoothGamma = 0;

    tiltHoldStart = null;
    levelHoldStart = null;
    lastSend = 0;

    spawnSent = false;
    score = 0;

    const tiltMeter = $('tiltMeter');
    const levelMeter = $('levelMeter');
    const tiltHoldText = $('tiltHoldText');
    const levelHoldText = $('levelHoldText');
    const gameScore = $('gameScore');

    if (tiltMeter) tiltMeter.style.width = '0%';
    if (levelMeter) levelMeter.style.width = '0%';
    if (tiltHoldText) tiltHoldText.textContent = '0.0s';
    if (levelHoldText) {
      levelHoldText.textContent =
        `0.0 / ${(LEVEL_HOLD_MS / 1000).toFixed(1)}초`;
    }
    if (gameScore) gameScore.textContent = '0';

    show('READY');
  }

  function startGame() {
    score = 0;

    const gameScore = $('gameScore');
    if (gameScore) gameScore.textContent = '0';

    show('GAME');
    requestAnimationFrame(moveFish);
  }

  function moveFish() {
    const area = $('gameArea');
    const fishTarget = $('fishTarget');

    if (!area || !fishTarget) return;

    const pad = 52;
    const width = Math.max(1, area.clientWidth - pad * 2);
    const height = Math.max(1, area.clientHeight - pad * 2);

    const x = pad + Math.random() * width;
    const y = pad + Math.random() * height;

    fishTarget.style.left = `${x}px`;
    fishTarget.style.top = `${y}px`;
  }

  const fishTarget = $('fishTarget');

  if (fishTarget) {
    fishTarget.addEventListener('click', () => {
      if (state !== 'GAME') return;

      score += 1;

      const gameScore = $('gameScore');
      if (gameScore) gameScore.textContent = String(score);

      if (score >= 5) {
        send('GAME_COMPLETE');
        show('WAIT_LEVEL');
      } else {
        moveFish();
      }
    });
  }

  const startBtn = $('startBtn');
  const retryBtn = $('retryBtn');

  if (startBtn) {
    startBtn.addEventListener('click', requestSensorPermission);
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', requestSensorPermission);
  }

  if (debug) {
    const debugPanel = $('debugPanel');
    const db = $('debugBeta');
    const dg = $('debugGamma');

    if (debugPanel) debugPanel.classList.add('show');

    const updateDebug = () => {
      if (!db || !dg) return;

      const betaLabel = $('debugBetaLabel');
      const gammaLabel = $('debugGammaLabel');

      if (betaLabel) betaLabel.textContent = db.value;
      if (gammaLabel) gammaLabel.textContent = dg.value;

      ingest(Number(db.value), Number(dg.value), performance.now());
    };

    if (db) db.addEventListener('input', updateDebug);
    if (dg) dg.addEventListener('input', updateDebug);

    const debugVideo3 = $('debugVideo3');
    const debugVideo4 = $('debugVideo4');

    if (debugVideo3) {
      debugVideo3.addEventListener('click', () => {
        if (state === 'WAIT_GAME') startGame();
      });
    }

    if (debugVideo4) {
      debugVideo4.addEventListener('click', () => {
        if (state === 'WAIT_LEVEL') show('LEVEL');
      });
    }

    setInterval(updateDebug, 50);
  }
})();
