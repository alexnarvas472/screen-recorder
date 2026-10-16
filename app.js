
'use strict';

const $ = id => document.getElementById(id);

const ui = {
  share: $('share'),
  record: $('record'),
  stop: $('stop'),
  shot: $('shot'),
  audio: $('audio'),
  delay: $('delay'),
  status: $('status'),
  live: $('live'),
  source: $('source'),
  timer: $('timer'),
  playback: $('playback'),
  videoDownload: $('videoDownload'),
  screenshot: $('screenshot'),
  imageDownload: $('imageDownload')
};

let stream = null;
let recorder = null;
let chunks = [];
let started = 0;
let ticker = null;
let videoUrl = null;
let imageUrl = null;
let pendingShot = null;

const say = message => {
  ui.status.textContent = message;
};

const stamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-');

function controls() {
  const active = !!stream?.getVideoTracks()
    .some(t => t.readyState === 'live');

  const recording = recorder?.state === 'recording';

  ui.share.disabled = !!recording;
  ui.record.disabled = !active || !!recording;
  ui.stop.disabled = !recording;
  ui.shot.disabled = !active;
  ui.audio.disabled = !!recording;
}

function cleanupCapture() {
  if (pendingShot) {
    clearTimeout(pendingShot);
    pendingShot = null;
  }

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  ui.live.srcObject = null;
  ui.source.textContent = 'No capture selected';

  if (recorder?.state === 'recording') {
    recorder.stop();
  }

  controls();
}

async function chooseCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    say(
      'Screen capture is unavailable. ' +
      'Open the published HTTPS GitHub Pages site in Chrome.'
    );
    return;
  }

  if (stream) cleanupCapture();

  try {
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: ui.audio.checked
    });

    stream = s;
    ui.live.srcObject = s;
    await ui.live.play();

    const track = s.getVideoTracks()[0];
    const settings = track.getSettings();

    ui.source.textContent =
      `Sharing: ${settings.displaySurface || 'selected source'} ` +
      `(${settings.width || '?'} × ${settings.height || '?'})`;

    track.addEventListener('ended', () => {
      say('Sharing ended.');
      cleanupCapture();
    });

    say(
      'Sharing is active. Switch to the selected tab; ' +
      'you can record or take screenshots here.'
    );

    controls();

  } catch (e) {
    say(
      e.name === 'NotAllowedError'
        ? 'Sharing was cancelled or denied.'
        : `Unable to start sharing: ${e.message}`
    );

    controls();
  }
}

function formatElapsed() {
  const seconds = Math.floor((Date.now() - started) / 1000);

  ui.timer.textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:` +
    `${String(seconds % 60).padStart(2, '0')}`;
}

function startRecording() {
  if (!stream || !window.MediaRecorder) {
    return say(
      'Start sharing first; recording is not supported in this browser.'
    );
  }

  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  const mimeType = types.find(t =>
    MediaRecorder.isTypeSupported(t)
  );

  if (!mimeType) {
    return say('This browser does not support WebM recording.');
  }

  chunks = [];

  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 3500000
    });

    recorder.ondataavailable = e => {
      if (e.data.size) chunks.push(e.data);
    };

    recorder.onerror = e => {
      say(
        `Recording error: ${e.error?.message || 'unknown error'}`
      );
    };

    recorder.onstop = () => {
      clearInterval(ticker);
      ticker = null;

      const blob = new Blob(chunks, { type: mimeType });

      if (blob.size) {
        if (videoUrl) URL.revokeObjectURL(videoUrl);

        videoUrl = URL.createObjectURL(blob);

        ui.playback.src = videoUrl;
        ui.videoDownload.href = videoUrl;
        ui.videoDownload.download =
          `recording-${stamp()}.webm`;

        ui.videoDownload.classList.remove('hidden');

        say(
          'Recording stopped. Use Download video to save it.'
        );
      } else {
        say('No recording data was captured.');
      }

      controls();
    };

    recorder.start(1000);

    started = Date.now();
    formatElapsed();

    ticker = setInterval(formatElapsed, 500);

    say(
      'Recording. You can work in the shared tab. ' +
      'Return here to stop.'
    );

    controls();

  } catch (e) {
    say(`Cannot record: ${e.message}`);
    controls();
  }
}

function stopRecording() {
  if (recorder?.state === 'recording') {
    recorder.stop();
  }
}

async function captureFrame() {
  pendingShot = null;

  if (!stream?.getVideoTracks()
    .some(t => t.readyState === 'live')) {
    return say(
      'Sharing has ended. Choose a tab again.'
    );
  }

  try {
    const v = ui.live;

    if (v.readyState < 2) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Video preview not ready')),
          5000
        );

        v.addEventListener('loadeddata', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }

    const w = v.videoWidth;
    const h = v.videoHeight;

    if (!w || !h) {
      throw new Error('No video frame available');
    }

    const canvas = document.createElement('canvas');

    canvas.width = w;
    canvas.height = h;

    canvas.getContext('2d').drawImage(
      v, 0, 0, w, h
    );

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/png')
    );

    if (!blob) {
      throw new Error('Could not create PNG');
    }

    if (imageUrl) URL.revokeObjectURL(imageUrl);

    imageUrl = URL.createObjectURL(blob);

    ui.screenshot.src = imageUrl;
    ui.screenshot.hidden = false;

    ui.imageDownload.href = imageUrl;
    ui.imageDownload.download =
      `screenshot-${stamp()}.png`;

    ui.imageDownload.classList.remove('hidden');

    say(
      'Screenshot captured. Use Download PNG to save it.'
    );

  } catch (e) {
    say(`Screenshot failed: ${e.message}`);
  }
}

function screenshot() {
  if (pendingShot) return;

  if (!stream) {
    return say('Choose a tab first.');
  }

  const delay = Number(ui.delay.value);

  if (delay) {
    say(
      `Screenshot scheduled in ${delay} seconds. ` +
      'You can switch tabs now.'
    );

    pendingShot = setTimeout(
      captureFrame,
      delay * 1000
    );
  } else {
    captureFrame();
  }
}

ui.share.addEventListener('click', chooseCapture);
ui.record.addEventListener('click', startRecording);
ui.stop.addEventListener('click', stopRecording);
ui.shot.addEventListener('click', screenshot);

window.addEventListener('beforeunload', () => {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }

  if (videoUrl) URL.revokeObjectURL(videoUrl);
  if (imageUrl) URL.revokeObjectURL(imageUrl);
});

controls();
