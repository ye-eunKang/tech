(() => {
  const canvas = document.getElementById('waterCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  let cssW = 1;
  let cssH = 1;
  let dpr = 1;

  let targetTilt = 0;
  let smoothTilt = 0;
  let fluidTilt = 0;
  let fluidVelocity = 0;
  let sloshStrength = 0;
  let flowDirection = 0;
  let tiltError = 0;

  let waterAmount = 0.895;
  let pourStrength = 0;
  let pourDirection = 0;
  let surfaceBaseY = 0;
  let surfaceSlope = 0;

  const bubbles = [];
  let lastSpawn = 0;
  let nextSpawnDelay = 1050;

  function resize() {
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : document.documentElement.getBoundingClientRect();

    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updateSurfaceGeometry();
  }

  function setTiltDegrees(degrees) {
    const safe = Number.isFinite(degrees) ? degrees : 0;
    targetTilt = clamp(safe / 84, -1, 1);
  }

  function reset() {
    targetTilt = 0;
    smoothTilt = 0;
    fluidTilt = 0;
    fluidVelocity = 0;
    sloshStrength = 0;
    flowDirection = 0;
    tiltError = 0;

    waterAmount = 0.895;
    pourStrength = 0;
    pourDirection = 0;

    bubbles.length = 0;
    lastSpawn = 0;
    nextSpawnDelay = 1050;

    updateSurfaceGeometry();
  }

  function spawnBubble(now) {
    if (waterAmount < 0.08) return;

    const size = 3 + Math.random() * 7;
    let x = cssW * 0.5;

    for (let tries = 0; tries < 12; tries += 1) {
      const candidate = cssW * (0.08 + Math.random() * 0.84);
      const surface = surfaceYAt(candidate, now * 0.001, 0);

      if (surface < cssH - 80) {
        x = candidate;
        break;
      }
    }

    bubbles.push({
      x,
      y: cssH + size + Math.random() * 18,
      r: size,
      vy: 18 + Math.random() * 28,
      phase: Math.random() * Math.PI * 2,
      sway: 4 + Math.random() * 11,
      opacity: 0.35 + Math.random() * 0.48,
      age: 0
    });

    lastSpawn = now;
    nextSpawnDelay = 930 + Math.random() * 2460;
  }

  function updateBubbles(dt, now) {
    if (waterAmount >= 0.10 && now - lastSpawn > nextSpawnDelay) {
      spawnBubble(now);
    }

    const t = now * 0.001;

    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
      const b = bubbles[i];

      b.age += dt;
      b.y -= b.vy * dt;
      b.x += Math.sin(b.phase + b.age * 2) * b.sway * dt;
      b.x += fluidTilt * 4 * dt;

      const surface = surfaceYAt(b.x, t, 0);
      const popY = surface + 100;

      if (b.y - b.r <= popY || waterAmount <= 0.01) {
        bubbles.splice(i, 1);
      }
    }
  }

  function volumeFractionForPlane(baseY, slope) {
    const samples = 52;
    let sum = 0;

    for (let i = 0; i < samples; i += 1) {
      const x = ((i + 0.5) / samples) * cssW;
      const y = baseY + slope * (x - cssW * 0.5);
      const depth = clamp(cssH - y, 0, cssH);
      sum += depth / cssH;
    }

    return sum / samples;
  }

  function solveBaseYForVolume(amount, slope) {
    let low = -cssH * 8;
    let high = cssH * 8;

    for (let i = 0; i < 32; i += 1) {
      const mid = (low + high) * 0.5;
      const volume = volumeFractionForPlane(mid, slope);

      if (volume > amount) low = mid;
      else high = mid;
    }

    return (low + high) * 0.5;
  }

  function updateSurfaceGeometry() {
    const angleDeg = clamp(fluidTilt * 84, -84, 84);
    const angleRad = angleDeg * Math.PI / 180;

    surfaceSlope = -Math.tan(angleRad);
    surfaceSlope = clamp(surfaceSlope, -9, 9);
    surfaceBaseY = solveBaseYForVolume(waterAmount, surfaceSlope);
  }

  function surfaceYAt(x, t, layer) {
    const layerValue = layer || 0;
    const nx = x / Math.max(1, cssW);

    const planeY =
      surfaceBaseY +
      surfaceSlope * (x - cssW * 0.5);

    const baseAmp =
      cssH * 0.010 * Math.max(0.55, waterAmount);

    const transientAmp =
      cssH *
      0.085 *
      sloshStrength *
      Math.max(0.42, waterAmount);

    const directional =
      flowDirection > 0
        ? 0.64 + 0.36 * nx
        : flowDirection < 0
          ? 1.0 - 0.36 * nx
          : 0.82;

    const amp = baseAmp + transientAmp * directional;
    const travel = flowDirection === 0 ? 1 : flowDirection;
    const speed = 0.12 + 0.34 * sloshStrength;

    const wave1 =
      Math.sin(
        (x / cssW) * Math.PI * 1.18 -
        travel * t * speed +
        layerValue * 1.10
      ) * amp;

    const wave2 =
      Math.sin(
        (x / cssW) * Math.PI * 1.85 -
        travel * t * speed * 0.42 +
        0.65 +
        layerValue
      ) * amp * 0.22;

    const broadSlosh =
      Math.sin((x / cssW) * Math.PI) *
      tiltError *
      cssH *
      0.12;

    return planeY + wave1 + wave2 + broadSlosh;
  }

  function drawSurfacePath(t, layer) {
    const step = Math.max(5, cssW / 46);
    const layerValue = layer || 0;

    ctx.beginPath();
    ctx.moveTo(0, surfaceYAt(0, t, layerValue));

    for (let x = step; x <= cssW + step; x += step) {
      ctx.lineTo(x, surfaceYAt(x, t, layerValue));
    }

    ctx.lineTo(cssW, cssH);
    ctx.lineTo(0, cssH);
    ctx.closePath();
  }

  function draw(now) {
    const t = now * 0.001;

    ctx.fillStyle = '#203e53';
    ctx.fillRect(0, 0, cssW, cssH);

    drawSurfacePath(t, 1);
    ctx.fillStyle = '#2796aa';
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    const backStep = Math.max(5, cssW / 52);
    ctx.moveTo(0, surfaceYAt(0, t, 1));

    for (let x = backStep; x <= cssW + backStep; x += backStep) {
      ctx.lineTo(x, surfaceYAt(x, t, 1));
    }

    ctx.strokeStyle = 'rgba(24, 122, 142, 0.55)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();

    drawSurfacePath(t, 0);

    const gradient =
      ctx.createLinearGradient(0, cssH * 0.08, 0, cssH);

    gradient.addColorStop(0, '#79e8f5');
    gradient.addColorStop(0.47, '#56cede');
    gradient.addColorStop(1, '#2ca4b8');

    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.save();
    ctx.beginPath();

    const frontStep = Math.max(4, cssW / 60);
    ctx.moveTo(0, surfaceYAt(0, t, 0));

    for (let x = frontStep; x <= cssW + frontStep; x += frontStep) {
      ctx.lineTo(x, surfaceYAt(x, t, 0));
    }

    ctx.strokeStyle = 'rgba(203, 250, 255, 0.42)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    drawSurfacePath(t, 0);
    ctx.clip();

    const glow =
      ctx.createLinearGradient(
        cssW * (0.25 - smoothTilt * 0.12),
        0,
        cssW * (0.78 - smoothTilt * 0.12),
        cssH
      );

    glow.addColorStop(0, 'rgba(255,255,255,0.07)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.restore();

    ctx.save();
    drawSurfacePath(t, 0);
    ctx.clip();

    for (const b of bubbles) {
      const alphaFade =
        clamp((cssH * 0.98 - b.y) / (cssH * 0.12), 0, 1);

      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle =
        'rgba(218,249,255,' +
        (b.opacity * alphaFade) +
        ')';
      ctx.fill();
    }

    ctx.restore();
  }

  let previous = performance.now();

  function frame(now) {
    const dt =
      Math.min(0.033, (now - previous) / 1000);

    previous = now;

    const inputEase =
      1 - Math.exp(-dt * 2.25);

    smoothTilt +=
      (targetTilt - smoothTilt) * inputEase;

    const error =
      smoothTilt - fluidTilt;

    tiltError = error;

    const SPRING = 4.7;
    const DAMPING = 4.9;

    fluidVelocity +=
      (error * SPRING - fluidVelocity * DAMPING) *
      dt;

    fluidTilt +=
      fluidVelocity * dt;

    const rawSlosh =
      Math.abs(error) * 4.8 +
      Math.abs(fluidVelocity) * 0.42;

    const targetSlosh =
      clamp(rawSlosh, 0, 1);

    const sloshRate =
      targetSlosh > sloshStrength
        ? 3.0
        : 1.15;

    const sloshEase =
      1 - Math.exp(-dt * sloshRate);

    sloshStrength +=
      (targetSlosh - sloshStrength) *
      sloshEase;

    if (fluidVelocity > 0.024) {
      flowDirection = 1;
    } else if (fluidVelocity < -0.024) {
      flowDirection = -1;
    } else if (sloshStrength < 0.022) {
      flowDirection = 0;
    }

    updateSurfaceGeometry();

    const edgeX =
      fluidTilt >= 0 ? cssW : 0;

    const edgePlaneY =
      surfaceBaseY +
      surfaceSlope * (edgeX - cssW * 0.5);

    const rimY = 1.5;
    const overflowPx = rimY - edgePlaneY;

    let targetPour = 0;

    if (overflowPx > 0 && waterAmount > 0.002) {
      targetPour =
        clamp(
          overflowPx /
            Math.max(18, cssH * 0.11),
          0,
          1
        );

      targetPour =
        Math.max(0.08, targetPour);

      pourDirection =
        fluidTilt >= 0 ? 1 : -1;
    } else {
      pourDirection = 0;
    }

    const pourEaseRate =
      targetPour > pourStrength
        ? 2.4
        : 4.0;

    const pourEase =
      1 - Math.exp(-dt * pourEaseRate);

    pourStrength +=
      (targetPour - pourStrength) *
      pourEase;

    if (
      pourStrength > 0.001 &&
      waterAmount > 0
    ) {
      const drainPerSecond =
        0.012 +
        0.16 *
          Math.pow(
            pourStrength,
            1.25
          );

      waterAmount =
        Math.max(
          0,
          waterAmount -
            drainPerSecond * dt
        );

      updateSurfaceGeometry();
    }

    updateBubbles(dt, now);
    draw(now);
    requestAnimationFrame(frame);
  }

  window.PhoneWater = {
    setTiltDegrees,
    reset,
    getWaterAmount: () => waterAmount,
    getPourStrength: () => pourStrength,
    getPourDirection: () => pourDirection,
    isPouring: () => pourStrength > 0.025
  };

  resize();
  reset();

  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();