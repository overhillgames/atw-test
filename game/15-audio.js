// Line Tower Wars runtime, part 15 of 20: audio context, unlock, sfx, music packs, playTowerFireSfx, playBonusManaSfx.
// Split from www/script.js on 2026-09-28. These are classic scripts sharing one
// global scope: load order is index.html's, and every top-level name here is
// visible to the other game/ files, lobby.js and the harness.

function ensureAudioContext() {
  if (!audioUnlocked && !audioCtx) {
    return null;
  }
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return null;
    }
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  ensureSfxMasterGain();
  return audioCtx;
}

function unlockAudioFromGesture() {
  audioUnlocked = true;
  ensureAudioContext();
}

function resumeAudioAfterBackground() {
  if (!audioUnlocked || !audioCtx) {
    return;
  }
  ensureAudioContext();
  syncMusicPlaybackForScreen();
}

function getVolumeScale(value) {
  return clamp(Number(value) || 0, 0, 100) / 100;
}

function ensureSfxMasterGain() {
  if (!audioCtx || sfxMasterGain) {
    return sfxMasterGain;
  }
  sfxMasterGain = audioCtx.createGain();
  sfxMasterGain.gain.value = getVolumeScale(gameOptions.sfxVolume);
  sfxMasterGain.connect(audioCtx.destination);
  return sfxMasterGain;
}

function connectSfxOutput(node) {
  const master = ensureSfxMasterGain();
  node.connect(master || audioCtx.destination);
}

function updateSfxVolume() {
  if (!sfxMasterGain || !audioCtx) {
    return;
  }
  sfxMasterGain.gain.setTargetAtTime(getVolumeScale(gameOptions.sfxVolume), audioCtx.currentTime, 0.02);
}

function ensureGauntletVictoryAudioElement() {
  if (gauntletVictoryAudioEl) {
    return gauntletVictoryAudioEl;
  }
  gauntletVictoryAudioEl = new Audio(GAUNTLET_VICTORY_SFX_SRC);
  gauntletVictoryAudioEl.preload = "auto";
  return gauntletVictoryAudioEl;
}

function playGauntletVictorySfx() {
  const audio = ensureGauntletVictoryAudioElement();
  audio.pause();
  audio.currentTime = 0;
  audio.volume = getVolumeScale(gameOptions.sfxVolume);
  audio.play().catch(() => {});
}

function updateMusicVolume() {
  if (!musicAudioEl) {
    return;
  }
  musicAudioEl.volume = getVolumeScale(gameOptions.musicVolume);
}

function getSelectedMusicPack() {
  const selected = getMusicPackOption(gameOptions.musicPack);
  return selected.tracks?.length ? selected : null;
}

function stopMusicFade() {
  if (!musicFadeTimer) {
    return;
  }
  window.clearInterval(musicFadeTimer);
  musicFadeTimer = null;
}

function ensureMusicAudioElement() {
  if (musicAudioEl) {
    return musicAudioEl;
  }
  musicAudioEl = new Audio();
  musicAudioEl.preload = "auto";
  musicAudioEl.addEventListener("ended", playNextMusicTrack);
  updateMusicVolume();
  return musicAudioEl;
}

function prepareCurrentMusicTrack(pack) {
  const tracks = pack.tracks || [];
  if (!tracks.length) {
    return null;
  }
  if (activeMusicPackId !== pack.id) {
    activeMusicPackId = pack.id;
    activeMusicTrackIndex = 0;
  }
  activeMusicTrackIndex = ((activeMusicTrackIndex % tracks.length) + tracks.length) % tracks.length;
  return tracks[activeMusicTrackIndex];
}

function playCurrentMusicTrack() {
  const pack = getSelectedMusicPack();
  if (!pack || state.screen !== "game" || !state.hasActiveMatch || state.gameOver) {
    return;
  }
  const track = prepareCurrentMusicTrack(pack);
  if (!track) {
    return;
  }
  const audio = ensureMusicAudioElement();
  stopMusicFade();
  if (audio.src !== new URL(track.src, window.location.href).href) {
    audio.src = track.src;
    audio.currentTime = 0;
  }
  updateMusicVolume();
  audio.play().catch(() => {});
}

function playNextMusicTrack() {
  const pack = getSelectedMusicPack();
  if (!pack) {
    return;
  }
  activeMusicPackId = pack.id;
  activeMusicTrackIndex = (activeMusicTrackIndex + 1) % pack.tracks.length;
  if (state.screen === "game" && state.hasActiveMatch && !state.gameOver) {
    playCurrentMusicTrack();
  }
}

function advanceSelectedMusicTrack() {
  const pack = getSelectedMusicPack();
  if (!pack) {
    return;
  }
  activeMusicPackId = pack.id;
  activeMusicTrackIndex = (activeMusicTrackIndex + 1) % pack.tracks.length;
}

function pauseMusicForMenu() {
  stopMusicFade();
  if (musicAudioEl && !musicAudioEl.paused) {
    musicAudioEl.pause();
  }
}

function fadeOutMatchMusic(advanceAfterFade = true) {
  stopMusicFade();
  if (advanceAfterFade) {
    advanceSelectedMusicTrack();
  }
  if (!musicAudioEl || musicAudioEl.paused) {
    return;
  }
  const audio = musicAudioEl;
  const startVolume = audio.volume;
  const startTime = performance.now();
  musicFadeTimer = window.setInterval(() => {
    const progress = clamp((performance.now() - startTime) / 1000, 0, 1);
    audio.volume = startVolume * (1 - progress);
    if (progress < 1) {
      return;
    }
    stopMusicFade();
    audio.pause();
    audio.currentTime = 0;
    updateMusicVolume();
  }, 50);
}

function syncMusicPlaybackForScreen() {
  if (state.screen === "game" && state.hasActiveMatch && !state.gameOver && !state.paused) {
    playCurrentMusicTrack();
  } else {
    pauseMusicForMenu();
  }
}

function playTowerFireSfx(towerId) {
  const ctxAudio = ensureAudioContext();
  if (!ctxAudio) {
    return;
  }

  const now = ctxAudio.currentTime;

  if (towerId === "violet") {
    const osc = ctxAudio.createOscillator();
    const gain = ctxAudio.createGain();
    const wobble = ctxAudio.createOscillator();
    const wobbleGain = ctxAudio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.09);
    wobble.type = "sine";
    wobble.frequency.setValueAtTime(7, now);
    wobbleGain.gain.setValueAtTime(16, now);
    wobble.connect(wobbleGain);
    wobbleGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain);
    connectSfxOutput(gain);
    wobble.start(now);
    osc.start(now);
    wobble.stop(now + 0.12);
    osc.stop(now + 0.12);
    return;
  }

  if (towerId === "yellow") {
    const osc = ctxAudio.createOscillator();
    const gateLfo = ctxAudio.createOscillator();
    const gateGain = ctxAudio.createGain();
    const gain = ctxAudio.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(2600, now);
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.06);
    gateLfo.type = "square";
    gateLfo.frequency.setValueAtTime(95, now);
    gateGain.gain.setValueAtTime(0.018, now);
    gateLfo.connect(gateGain);
    gateGain.connect(gain.gain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.028, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    connectSfxOutput(gain);
    gateLfo.start(now);
    osc.start(now);
    gateLfo.stop(now + 0.075);
    osc.stop(now + 0.075);
    return;
  }

  if (towerId === "red") {
    const osc = ctxAudio.createOscillator();
    const toneGain = ctxAudio.createGain();
    const noise = ctxAudio.createBufferSource();
    const noiseGain = ctxAudio.createGain();
    const mix = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();
    const duration = 0.2;

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(560, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + duration);
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.08, now + 0.016);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const sampleRate = ctxAudio.sampleRate;
    const frameCount = Math.floor(sampleRate * duration);
    const buffer = ctxAudio.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.7;
    }
    noise.buffer = buffer;
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(620, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + duration);
    filter.Q.value = 0.9;

    mix.gain.setValueAtTime(0.9, now);
    osc.connect(toneGain);
    toneGain.connect(filter);
    noise.connect(noiseGain);
    noiseGain.connect(filter);
    filter.connect(mix);
    connectSfxOutput(mix);

    osc.start(now);
    noise.start(now);
    osc.stop(now + duration);
    noise.stop(now + duration);
    return;
  }

  if (towerId === "green") {
    const osc = ctxAudio.createOscillator();
    const lfo = ctxAudio.createOscillator();
    const lfoGain = ctxAudio.createGain();
    const gain = ctxAudio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(460, now + 0.06);
    osc.frequency.linearRampToValueAtTime(300, now + 0.12);
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(18, now);
    lfoGain.gain.setValueAtTime(26, now);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    connectSfxOutput(gain);
    lfo.start(now);
    osc.start(now);
    lfo.stop(now + 0.14);
    osc.stop(now + 0.14);
    return;
  }

  if (towerId === "blue") {
    const osc = ctxAudio.createOscillator();
    const gain = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.12);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, now);
    filter.Q.value = 1.5;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(filter);
    filter.connect(gain);
    connectSfxOutput(gain);
    osc.start(now);
    osc.stop(now + 0.14);
  }
}

function playBonusManaSfx(source = "kill") {
  const ctxAudio = ensureAudioContext();
  if (!ctxAudio) {
    return;
  }
  const now = ctxAudio.currentTime;

  if (source === "score") {
    const osc = ctxAudio.createOscillator();
    const gain = ctxAudio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.linearRampToValueAtTime(760, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    connectSfxOutput(gain);
    osc.start(now);
    osc.stop(now + 0.13);
    return;
  }

  const osc = ctxAudio.createOscillator();
  const filter = ctxAudio.createBiquadFilter();
  const gain = ctxAudio.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(240, now);
  osc.frequency.exponentialRampToValueAtTime(130, now + 0.055);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(320, now);
  filter.Q.value = 0.9;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  osc.connect(filter);
  filter.connect(gain);
  connectSfxOutput(gain);
  osc.start(now);
  osc.stop(now + 0.095);
}
