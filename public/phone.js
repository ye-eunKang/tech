(() => {
  const qs = new URLSearchParams(location.search);
  const fishId = qs.get('fish') || 'fish01';
  const debug = qs.get('debug') === '1';
  const idle = qs.get('idle') === '1';

  const WATER_COMPLETE_AMOUNT = 0.16;
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
  let levelHoldStart = null;
  let lastSend = 0;
  let spawnSent = false;
  let sensorAttached = false;
  let permissionPending = false;
  let sessionStarted = false;
  let initialAutoStartDone = false;
  let waterCompleteSent = false;

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

  if (debug) {
    document.body.classList.add('debug-mode');
  }

  function show(name) {
    state = name;

    stages.forEach(el => {
      el.classList.remove('active');
    });

    const map = {
      READY: 'stage-ready',
      TILT: 'stage-tilt',
      WAIT_GAME: 'stage-wait-game',
      GAME: 'stage-game',
      WAIT_LEVEL: 'stage-wait-level',
      LEVEL: 'stage-level',
      ERROR: 'stage-error'
    };

    const target = $(map[name]);
    if (target) target.classList.add('active');
  }

  function send(type, extra = {}, options = {}) {
    socket.send(
      Object.assign(
        { type: type, fishId: fishId },
        extra
      ),
      options
    );
  }

  function getLateralTilt(rawBeta, rawGamma) {
    const orientationAngle =
      screen.orientation &&
      typeof screen.orientation.angle === 'number'
        ? screen.orientation.angle
        : (window.orientation || 0);

    if (
      Math.abs(orientationAngle) === 90 ||
      orientationAngle === 270
    ) {
      return orientationAngle === 90
        ? rawBeta
        : -rawBeta;
    }

    return rawGamma;
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

  async function requestSensorFromGesture() {
    try {
      const root = document.documentElement;

      if (
        !document.fullscreenElement &&
        root.requestFullscreen
      ) {
        root.requestFullscreen({
          navigationUI: 'hide'
        }).catch(() => {});
      }

      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const result =
          await DeviceOrientationEvent.requestPermission();

        if (result !== 'granted') {
          throw new Error(
            '기울기 센서 권한이 허용되지 않았습니다.'
          );
        }
      }

      permissionPending = false;
      attachSensor();
      startWaterSession();
    } catch (err) {
      const errorText = $('errorText');

      if (errorText) {
        errorText.textContent =
          err.message +
          ' 브라우저의 동작 및 방향 접근 권한을 확인해 주세요.';
      }

      show('ERROR');
    }
  }

  function startWaterSession() {
    if (sessionStarted) return;

    sessionStarted = true;
    waterCompleteSent = false;
    spawnSent = false;
    levelHoldStart = null;
    lastSend = 0;

    if (window.PhoneWater) {
      PhoneWater.reset();
      PhoneWater.setTiltDegrees(0);
    }

    show('TILT');
    send('SESSION_START');
  }

  async function beginNfcSession() {
    if (debug) {
      startWaterSession();
      return;
    }

    if (
      typeof DeviceOrientationEvent === 'undefined'
    ) {
      const errorText = $('errorText');

      if (errorText) {
        errorText.textContent =
          '이 브라우저에서는 기울기 센서를 찾을 수 없습니다.';
      }

      show('ERROR');
      return;
    }

    if (
      typeof DeviceOrientationEvent.requestPermission ===
      'function'
    ) {
      permissionPending = true;
      show('READY');
      return;
    }

    attachSensor();
    startWaterSession();
  }

  function returnToLogo() {
    sessionStarted = false;
    waterCompleteSent = false;
    spawnSent = false;
    levelHoldStart = null;
    lastSend = 0;

    beta = 0;
    gamma = 0;
    smoothBeta = 0;
    smoothGamma = 0;

    resetCraneGame();

    if (window.PhoneWater) {
      PhoneWater.reset();
      PhoneWater.setTiltDegrees(0);
    }

    const levelMeter = $('levelMeter');
    const levelHoldText = $('levelHoldText');

    if (levelMeter) {
      levelMeter.style.width = '0%';
    }

    if (levelHoldText) {
      levelHoldText.textContent = '0.0 / 2.0초';
    }

    show('READY');
  }

  const socket = new FishSocket({
    role: 'phone',
    fishId: fishId,

    onStatus(status, delay) {
      if (!conn) return;

      if (status === 'open') {
        conn.textContent = '서버 연결됨';
      } else if (status === 'reconnecting') {
        conn.textContent =
          '재연결 중… ' +
          Math.round(delay / 1000) +
          '초';
      } else if (status === 'error') {
        conn.textContent = '연결 오류';
      } else {
        conn.textContent = '서버 연결 중…';
      }
    },

    onOpen() {
      if (!initialAutoStartDone && !idle) {
        initialAutoStartDone = true;
        beginNfcSession();
      }
    },

    onMessage(msg) {
      if (
        msg.type === 'VIDEO3_ENDED' &&
        state === 'WAIT_GAME'
      ) {
        startGame();
      }

      if (
        msg.type === 'VIDEO4_ENDED' &&
        state === 'WAIT_LEVEL'
      ) {
        levelHoldStart = null;
        show('LEVEL');
      }
    }
  });

  function ingest(rawBeta, rawGamma, now) {
    smoothBeta +=
      (rawBeta - smoothBeta) *
      SMOOTHING;

    smoothGamma +=
      (rawGamma - smoothGamma) *
      SMOOTHING;

    if (state === 'TILT') {
      const lateralTilt =
        getLateralTilt(
          rawBeta,
          rawGamma
        );

      if (window.PhoneWater) {
        PhoneWater.setTiltDegrees(
          lateralTilt
        );
      }

      const waterAmount =
        window.PhoneWater
          ? PhoneWater.getWaterAmount()
          : 1;

      const pourStrength =
        window.PhoneWater
          ? PhoneWater.getPourStrength()
          : 0;

      const playing =
        window.PhoneWater
          ? PhoneWater.isPouring()
          : false;

      if (
        now - lastSend >=
        SEND_INTERVAL_MS
      ) {
        lastSend = now;

        send(
          'TILT',
          {
            beta:
              +smoothBeta.toFixed(2),
            gamma:
              +lateralTilt.toFixed(2),
            playing: playing,
            waterAmount:
              +waterAmount.toFixed(4),
            pourStrength:
              +pourStrength.toFixed(4)
          },
          { volatile: true }
        );
      }

      if (
        waterAmount <=
          WATER_COMPLETE_AMOUNT &&
        !waterCompleteSent
      ) {
        waterCompleteSent = true;

        send('TILT_COMPLETE', {
          beta:
            +smoothBeta.toFixed(2),
          gamma:
            +lateralTilt.toFixed(2),
          waterAmount:
            +waterAmount.toFixed(4)
        });

        if (window.PhoneWater) {
          PhoneWater.setTiltDegrees(0);
        }

        show('WAIT_GAME');
      }
    }

    if (state === 'GAME') {
      updateCraneTilt(
        rawBeta,
        rawGamma,
        now
      );
    }

    if (state === 'LEVEL') {
      const betaText = $('betaText');
      const levelGammaText =
        $('levelGammaText');
      const levelMeter =
        $('levelMeter');
      const levelHoldText =
        $('levelHoldText');

      if (betaText) {
        betaText.textContent =
          smoothBeta.toFixed(1) +
          '°';
      }

      if (levelGammaText) {
        levelGammaText.textContent =
          smoothGamma.toFixed(1) +
          '°';
      }

      const level =
        Math.abs(smoothBeta) <=
          LEVEL_TOLERANCE &&
        Math.abs(smoothGamma) <=
          LEVEL_TOLERANCE;

      if (level) {
        if (levelHoldStart == null) {
          levelHoldStart = now;
        }
      } else {
        levelHoldStart = null;
      }

      const held =
        levelHoldStart == null
          ? 0
          : Math.min(
              LEVEL_HOLD_MS,
              now - levelHoldStart
            );

      if (levelMeter) {
        levelMeter.style.width =
          Math.max(
            0,
            Math.min(
              100,
              (held /
                LEVEL_HOLD_MS) *
                100
            )
          ) +
          '%';
      }

      if (levelHoldText) {
        levelHoldText.textContent =
          (held / 1000).toFixed(1) +
          ' / 2.0초';
      }

      if (
        held >= LEVEL_HOLD_MS &&
        !spawnSent
      ) {
        spawnSent = true;

        send('SPAWN_FISH', {
          beta:
            +smoothBeta.toFixed(2),
          gamma:
            +smoothGamma.toFixed(2)
        });

        // 마지막 성공 직후 휴대폰은 로고 화면으로 바로 돌아간다.
        // 디스플레이는 기존 SPAWN_FISH 처리에서 3초 뒤 기본 영상으로 복귀한다.
        returnToLogo();
      }
    }
  }

  function startGame() {
    show('GAME');
    resetCraneGame();

    const playfield =
      $('cranePlayfield');

    if (playfield) {
      const startX =
        Math.max(
          44,
          playfield.clientWidth *
            0.16
        );

      gameClawX = startX;
      gameTargetX = startX;
    }

    gameRaf =
      requestAnimationFrame(
        craneGameLoop
      );
  }

  function updateCraneTilt(
    rawBeta,
    rawGamma,
    now
  ) {
    if (
      gameDropping ||
      state !== 'GAME'
    ) {
      return;
    }

    const playfield =
      $('cranePlayfield');

    if (!playfield) return;

    const currentTilt =
      getLateralTilt(
        rawBeta,
        rawGamma
      );

    gameTilt = currentTilt;

    const minX = 42;
    const maxX =
      Math.max(
        minX,
        playfield.clientWidth - 42
      );

    gameTargetX =
      (playfield.clientWidth / 2) +
      currentTilt *
        CRANE_SENSITIVITY;

    gameTargetX =
      Math.max(
        minX,
        Math.min(
          maxX,
          gameTargetX
        )
      );

    if (gameHoldAnchor == null) {
      gameHoldAnchor =
        currentTilt;
      gameHoldStart = now;
    } else {
      const delta =
        Math.abs(
          currentTilt -
          gameHoldAnchor
        );

      if (
        delta >
        CRANE_STILL_TOLERANCE
      ) {
        gameHoldAnchor =
          currentTilt;
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

    if (
      !gameDropping &&
      rig
    ) {
      gameClawX +=
        (gameTargetX -
          gameClawX) *
        0.18;

      rig.style.left =
        gameClawX + 'px';

      if (gameHoldStart != null) {
        const elapsed =
          Math.max(
            0,
            now -
              gameHoldStart
          );

        const ratio =
          Math.min(
            1,
            elapsed /
              CRANE_HOLD_MS
          );

        setCraneProgress(ratio);

        if (ratio >= 1) {
          triggerCraneDrop();
        }
      }
    }

    gameRaf =
      requestAnimationFrame(
        craneGameLoop
      );
  }

  function setCraneProgress(ratio) {
    const progress =
      $('craneProgress');

    const holdText =
      $('craneHoldText');

    if (progress) {
      progress.style.width =
        Math.max(
          0,
          Math.min(
            100,
            ratio * 100
          )
        ) +
        '%';
    }

    if (holdText) {
      holdText.textContent =
        String(
          Math.min(
            CRANE_HOLD_MS,
            ratio *
              CRANE_HOLD_MS
          ) / 1000
        );
    }
  }

  function resetCraneGame() {
    if (gameRaf) {
      cancelAnimationFrame(
        gameRaf
      );
      gameRaf = null;
    }

    gameHoldAnchor = null;
    gameHoldStart = null;
    gameDropping = false;
    gameTilt = 0;

    const playfield =
      $('cranePlayfield');

    const rig = $('craneRig');
    const line = $('craneLine');
    const head = $('craneHead');
    const guide = $('craneGuide');
    const fish =
      $('fishIcecream');

    const grabbed =
      $('grabbedFish');

    if (playfield) {
      const startX =
        Math.max(
          44,
          playfield.clientWidth *
            0.16
        );

      gameClawX = startX;
      gameTargetX = startX;
    }

    if (rig) {
      rig.style.left =
        (gameClawX || 48) +
        'px';
    }

    if (line) {
      line.style.transition =
        'none';

      line.style.height =
        '70px';

      requestAnimationFrame(
        () => {
          line.style.transition =
            '';
        }
      );
    }

    if (head) {
      head.classList.remove(
        'open'
      );
    }

    if (guide) {
      guide.textContent =
        '휴대폰을 좌우로 기울여 집게를 움직이고, 원하는 위치에서 3초간 멈추세요.';
    }

    if (fish) {
      fish.classList.remove(
        'hidden'
      );
    }

    if (grabbed) {
      grabbed.classList.remove(
        'show'
      );
    }

    setCraneProgress(0);
  }

  function triggerCraneDrop() {
    if (
      gameDropping ||
      state !== 'GAME'
    ) {
      return;
    }

    const playfield =
      $('cranePlayfield');

    const line =
      $('craneLine');

    const head =
      $('craneHead');

    const guide =
      $('craneGuide');

    const fish =
      $('fishIcecream');

    const grabbed =
      $('grabbedFish');

    if (
      !playfield ||
      !line ||
      !head ||
      !fish
    ) {
      return;
    }

    gameDropping = true;
    gameHoldStart = null;
    gameHoldAnchor = null;

    setCraneProgress(1);

    if (guide) {
      guide.textContent =
        '집게가 내려갑니다.';
    }

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    head.classList.add('open');

    const fieldRect =
      playfield.getBoundingClientRect();

    const fishRect =
      fish.getBoundingClientRect();

    const targetCenterY =
      fishRect.top -
      fieldRect.top +
      fishRect.height / 2;

    const dropHeight =
      Math.max(
        115,
        targetCenterY - 28
      );

    line.style.transition =
      'height 0.85s cubic-bezier(0.25, 1, 0.5, 1)';

    line.style.height =
      dropHeight + 'px';

    setTimeout(() => {
      const targetCenterX =
        fishRect.left -
        fieldRect.left +
        fishRect.width / 2;

      const caught =
        Math.abs(
          gameClawX -
          targetCenterX
        ) <= 46;

      head.classList.remove(
        'open'
      );

      if (navigator.vibrate) {
        navigator.vibrate(
          [60, 35, 60]
        );
      }

      if (caught) {
        fish.classList.add(
          'hidden'
        );

        if (grabbed) {
          grabbed.classList.add(
            'show'
          );
        }

        if (guide) {
          guide.textContent =
            '붕어 아이스크림을 잡았습니다!';
        }
      } else if (guide) {
        guide.textContent =
          '놓쳤어요. 다시 위치를 맞춰 보세요.';
      }

      setTimeout(() => {
        line.style.transition =
          'height 0.8s cubic-bezier(0.4, 0, 0.6, 1)';

        line.style.height =
          '70px';

        setTimeout(() => {
          if (caught) {
            if (gameRaf) {
              cancelAnimationFrame(
                gameRaf
              );

              gameRaf = null;
            }

            send('GAME_COMPLETE');
            show('WAIT_LEVEL');
          } else {
            gameDropping =
              false;

            gameHoldAnchor =
              gameTilt;

            gameHoldStart =
              performance.now();

            setCraneProgress(0);
          }
        }, 850);
      }, 350);
    }, 900);
  }

  const retryBtn =
    $('retryBtn');

  if (retryBtn) {
    retryBtn.addEventListener(
      'click',
      requestSensorFromGesture
    );
  }

  document.addEventListener(
    'pointerdown',
    () => {
      if (permissionPending) {
        requestSensorFromGesture();
        return;
      }

      const root =
        document.documentElement;

      if (
        !document.fullscreenElement &&
        root.requestFullscreen
      ) {
        root.requestFullscreen({
          navigationUI: 'hide'
        }).catch(() => {});
      }
    },
    { passive: true }
  );

  if (debug) {
    const debugPanel =
      $('debugPanel');

    const db =
      $('debugBeta');

    const dg =
      $('debugGamma');

    if (debugPanel) {
      debugPanel.classList.add(
        'show'
      );
    }

    const updateDebug =
      () => {
        if (!db || !dg) return;

        const betaLabel =
          $('debugBetaLabel');

        const gammaLabel =
          $('debugGammaLabel');

        if (betaLabel) {
          betaLabel.textContent =
            db.value;
        }

        if (gammaLabel) {
          gammaLabel.textContent =
            dg.value;
        }

        ingest(
          Number(db.value),
          Number(dg.value),
          performance.now()
        );
      };

    if (db) {
      db.addEventListener(
        'input',
        updateDebug
      );
    }

    if (dg) {
      dg.addEventListener(
        'input',
        updateDebug
      );
    }

    const debugVideo3 =
      $('debugVideo3');

    const debugVideo4 =
      $('debugVideo4');

    const debugReset =
      $('debugReset');

    if (debugVideo3) {
      debugVideo3.addEventListener(
        'click',
        () => {
          if (
            state ===
            'WAIT_GAME'
          ) {
            startGame();
          }
        }
      );
    }

    if (debugVideo4) {
      debugVideo4.addEventListener(
        'click',
        () => {
          if (
            state ===
            'WAIT_LEVEL'
          ) {
            show('LEVEL');
          }
        }
      );
    }

    if (debugReset) {
      debugReset.addEventListener(
        'click',
        returnToLogo
      );
    }

    setInterval(
      updateDebug,
      50
    );
  }

  show('READY');
})();