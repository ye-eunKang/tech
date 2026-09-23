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

  const CRANE_HOLD_MS = 3000;
  const CRANE_STILL_TOLERANCE = 2.0;
  const CRANE_SENSITIVITY = 18;

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

  let gameTilt = 0;
  let gameTargetX = 0;
  let gameClawX = 0;
  let gameHoldAnchor = null;
  let gameHoldStart = null;
  let gameDropping = false;
  let gameRaf = null;

  const $ = id => document.getElementById(id);
  const conn = $('conn');
  const stages = [...document.querySelectorAll('.stage')];

  function show(name) {
    state = name;
    document.body.classList.toggle('game-mode', name === 'GAME');
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
      // 서버 연결만 유지하고, 전시 시작 신호는
      // 사용자가 '시작하기' 버튼을 눌렀을 때 보낸다.
    },

    onMessage(msg) {
      if (msg.type === 'VIDEO3_ENDED' && state === 'WAIT_GAME') {
        startGame();
      }

      if (msg.type === 'VIDEO4_ENDED' && state === 'WAIT_LEVEL') {
        levelHoldStart = null;
        show('LEVEL');
      }

      if (msg.type === 'SPAWN_ACK') {
        const completeStatus = $('completeStatus');

        if (completeStatus) {
          if (Number(msg.delivered) > 0) {
            completeStatus.textContent =
              `${fishId} 신호가 TouchDesigner에 전달되었습니다.`;
          } else {
            completeStatus.textContent =
              'TouchDesigner가 현재 서버에 연결되어 있지 않습니다.';
          }
        }
      }
    }
  });

  function send(type, extra = {}, options = {}) {
    socket.send({ type, fishId, ...extra }, options);
  }

  async function requestSensorPermission() {
    try {
      // 지원 브라우저에서는 시작 버튼의 사용자 제스처를 이용해
      // 브라우저 UI를 숨기는 fullscreen을 요청한다.
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) {
        root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }

      if (!sessionStarted) {
        sessionStarted = true;
        send('SESSION_START');
      }

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

    if (state === 'GAME') {
      updateCraneTilt(rawBeta, rawGamma, now);
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
        const completeStatus = $('completeStatus');

        if (completeFishId) completeFishId.textContent = fishId;
        if (completeStatus) {
          completeStatus.textContent =
            `${fishId} 신호를 TouchDesigner로 전송 중입니다.`;
        }

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
    sessionStarted = false;

    resetCraneGame();

    const tiltMeter = $('tiltMeter');
    const levelMeter = $('levelMeter');
    const tiltHoldText = $('tiltHoldText');
    const levelHoldText = $('levelHoldText');
    if (tiltMeter) tiltMeter.style.width = '0%';
    if (levelMeter) levelMeter.style.width = '0%';
    if (tiltHoldText) tiltHoldText.textContent = '0.0s';
    if (levelHoldText) {
      levelHoldText.textContent =
        `0.0 / ${(LEVEL_HOLD_MS / 1000).toFixed(1)}초`;
    }

    show('READY');
  }

  function startGame() {
    show('GAME');
    resetCraneGame();

    const playfield = $('cranePlayfield');
    if (playfield) {
      const startX = Math.max(44, playfield.clientWidth * 0.16);
      gameClawX = startX;
      gameTargetX = startX;
    }

    gameRaf = requestAnimationFrame(craneGameLoop);
  }

  function getCraneTilt(rawBeta, rawGamma) {
    const orientationAngle =
      screen.orientation && typeof screen.orientation.angle === 'number'
        ? screen.orientation.angle
        : (window.orientation || 0);

    if (Math.abs(orientationAngle) === 90 || orientationAngle === 270) {
      return orientationAngle === 90 ? rawBeta : -rawBeta;
    }

    return rawGamma;
  }

  function updateCraneTilt(rawBeta, rawGamma, now) {
    if (gameDropping || state !== 'GAME') return;

    const playfield = $('cranePlayfield');
    if (!playfield) return;

    const currentTilt = getCraneTilt(rawBeta, rawGamma);
    gameTilt = currentTilt;

    const minX = 42;
    const maxX = Math.max(minX, playfield.clientWidth - 42);
    gameTargetX =
      (playfield.clientWidth / 2) + (currentTilt * CRANE_SENSITIVITY);
    gameTargetX = Math.max(minX, Math.min(maxX, gameTargetX));

    if (gameHoldAnchor == null) {
      gameHoldAnchor = currentTilt;
      gameHoldStart = now;
    } else {
      const delta = Math.abs(currentTilt - gameHoldAnchor);

      if (delta > CRANE_STILL_TOLERANCE) {
        gameHoldAnchor = currentTilt;
        gameHoldStart = now;
        setCraneProgress(0);
      }
    }
  }

  function craneGameLoop(now) {
    if (state !== 'GAME') {
      gameRaf = null;
      return;
    }

    const rig = $('craneRig');

    if (!gameDropping && rig) {
      gameClawX += (gameTargetX - gameClawX) * 0.18;
      rig.style.left = `${gameClawX}px`;

      if (gameHoldStart != null) {
        const elapsed = Math.max(0, now - gameHoldStart);
        const ratio = Math.min(1, elapsed / CRANE_HOLD_MS);
        setCraneProgress(ratio);

        if (ratio >= 1) {
          triggerCraneDrop();
        }
      }
    }

    gameRaf = requestAnimationFrame(craneGameLoop);
  }

  function setCraneProgress(ratio) {
    const progress = $('craneProgress');
    const holdText = $('craneHoldText');

    if (progress) {
      progress.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    }

    if (holdText) {
      holdText.textContent =
        `${Math.min(CRANE_HOLD_MS, ratio * CRANE_HOLD_MS / 1).toFixed(0) / 1000}`;
    }
  }

  function resetCraneGame() {
    if (gameRaf) {
      cancelAnimationFrame(gameRaf);
      gameRaf = null;
    }

    gameHoldAnchor = null;
    gameHoldStart = null;
    gameDropping = false;
    gameTilt = 0;

    const playfield = $('cranePlayfield');
    const rig = $('craneRig');
    const line = $('craneLine');
    const head = $('craneHead');
    const guide = $('craneGuide');
    const fish = $('fishIcecream');
    const grabbed = $('grabbedFish');

    if (playfield) {
      const startX = Math.max(44, playfield.clientWidth * 0.16);
      gameClawX = startX;
      gameTargetX = startX;
    }

    if (rig) rig.style.left = `${gameClawX || 48}px`;
    if (line) {
      line.style.transition = 'none';
      line.style.height = '70px';
      requestAnimationFrame(() => {
        line.style.transition = '';
      });
    }

    if (head) head.classList.remove('open');
    if (guide) {
      guide.textContent =
        '휴대폰을 좌우로 기울여 집게를 움직이고, 원하는 위치에서 3초간 멈추세요.';
    }

    if (fish) fish.classList.remove('hidden');
    if (grabbed) grabbed.classList.remove('show');

    setCraneProgress(0);
  }

  function triggerCraneDrop() {
    if (gameDropping || state !== 'GAME') return;

    const playfield = $('cranePlayfield');
    const rig = $('craneRig');
    const line = $('craneLine');
    const head = $('craneHead');
    const guide = $('craneGuide');
    const fish = $('fishIcecream');
    const grabbed = $('grabbedFish');

    if (!playfield || !rig || !line || !head || !fish) return;

    gameDropping = true;
    gameHoldStart = null;
    gameHoldAnchor = null;
    setCraneProgress(1);

    if (guide) guide.textContent = '집게가 내려갑니다.';
    if (navigator.vibrate) navigator.vibrate(50);

    head.classList.add('open');

    const fieldRect = playfield.getBoundingClientRect();
    const fishRect = fish.getBoundingClientRect();
    const targetCenterY =
      fishRect.top - fieldRect.top + (fishRect.height / 2);

    const dropHeight = Math.max(
      115,
      targetCenterY - 28
    );

    line.style.transition =
      'height 0.85s cubic-bezier(0.25, 1, 0.5, 1)';
    line.style.height = `${dropHeight}px`;

    setTimeout(() => {
      const targetCenterX =
        fishRect.left - fieldRect.left + (fishRect.width / 2);
      const caught = Math.abs(gameClawX - targetCenterX) <= 46;

      head.classList.remove('open');
      if (navigator.vibrate) navigator.vibrate([60, 35, 60]);

      if (caught) {
        fish.classList.add('hidden');
        if (grabbed) grabbed.classList.add('show');
        if (guide) guide.textContent = '붕어 아이스크림을 잡았습니다!';
      } else if (guide) {
        guide.textContent = '놓쳤어요. 다시 위치를 맞춰 보세요.';
      }

      setTimeout(() => {
        line.style.transition =
          'height 0.8s cubic-bezier(0.4, 0, 0.6, 1)';
        line.style.height = '70px';

        setTimeout(() => {
          if (caught) {
            if (gameRaf) {
              cancelAnimationFrame(gameRaf);
              gameRaf = null;
            }

            send('GAME_COMPLETE');
            show('WAIT_LEVEL');
          } else {
            gameDropping = false;
            gameHoldAnchor = gameTilt;
            gameHoldStart = performance.now();
            setCraneProgress(0);
          }
        }, 850);
      }, 350);
    }, 900);
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
