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
  imageDownload: $('imageDownload'),

  spliceUrl: $('spliceUrl'),
  saveSpliceUrl: $('saveSpliceUrl'),
  openSplice: $('openSplice'),
  sendSplice: $('sendSplice')
};

let stream = null;
let recorder = null;
let chunks = [];
let started = 0;
let ticker = null;

let videoUrl = null;
let territoryVideoBlob = null;
let imageUrl = null;
let pendingShot = null;

let lastScreenshotBase64 = null;
let lastScreenshotFilename = null;

let spliceWindow = null;


// -----------------------------------------------------
// BASIC HELPERS
// -----------------------------------------------------

function say(message) {
  ui.status.textContent = message;
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-');
}

function controls() {
  const active =
    !!stream?.getVideoTracks()
      .some(track => track.readyState === 'live');

  const recording =
    recorder?.state === 'recording';

  ui.share.disabled = recording;
  ui.record.disabled = !active || recording;
  ui.stop.disabled = !recording;
  ui.shot.disabled = !active;
  ui.audio.disabled = recording;

  if (ui.sendSplice) {
    ui.sendSplice.disabled =
      !lastScreenshotBase64;
  }
}


// -----------------------------------------------------
// REMEMBER SPLICE BENCH URL
// -----------------------------------------------------

function loadSavedSpliceUrl() {
  const saved =
    localStorage.getItem('spliceBenchUrl');

  if (saved && ui.spliceUrl) {
    ui.spliceUrl.value = saved;
  }
}

function saveSpliceUrl() {
  const url =
    String(ui.spliceUrl?.value || '').trim();

  if (!url) {
    say('Enter your Splice Bench web app URL first.');
    return;
  }

  localStorage.setItem(
    'spliceBenchUrl',
    url
  );

  say('Splice Bench URL saved.');
}


// -----------------------------------------------------
// SCREEN SHARE
// -----------------------------------------------------

async function chooseCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    say(
      'Screen capture is unavailable. ' +
      'Open the published GitHub Pages site in Chrome.'
    );
    return;
  }

  if (stream) {
    cleanupCapture();
  }

  try {
    stream =
      await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30
        },
        audio: ui.audio.checked
      });

    ui.live.srcObject = stream;

    await ui.live.play();

    const track =
      stream.getVideoTracks()[0];

    const settings =
      track.getSettings();

    ui.source.textContent =
      `Sharing: ${
        settings.displaySurface || 'selected source'
      } (${settings.width || '?'} × ${
        settings.height || '?'
      })`;

    track.addEventListener(
      'ended',
      () => {
        say('Sharing ended.');
        cleanupCapture();
      }
    );

    say(
      'Sharing is active. You can record or take screenshots.'
    );

    controls();

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      say(
        'Sharing was cancelled or permission was denied.'
      );
    } else {
      say(
        `Unable to start sharing: ${err.message}`
      );
    }

    controls();
  }
}


// -----------------------------------------------------
// CLEANUP
// -----------------------------------------------------

function cleanupCapture() {
  if (pendingShot) {
    clearTimeout(pendingShot);
    pendingShot = null;
  }

  endRecording();

  if (stream) {
    stream
      .getTracks()
      .forEach(track => track.stop());

    stream = null;
  }

  ui.live.srcObject = null;

  ui.source.textContent =
    'No capture selected';

  controls();
}


// -----------------------------------------------------
// RECORDING TIMER
// -----------------------------------------------------

function formatElapsed() {
  const seconds =
    Math.floor(
      (Date.now() - started) / 1000
    );

  const mins =
    Math.floor(seconds / 60);

  const secs =
    seconds % 60;

  ui.timer.textContent =
    `${String(mins).padStart(2, '0')}:` +
    `${String(secs).padStart(2, '0')}` +
    (session && session.minutes && !session.stopped ? ` · part ${session.part}` : '');
}


// -----------------------------------------------------
// RECORDING, SPLIT INTO PARTS
// Every few minutes (4 by default) the current part is closed
// and the next one starts at once. Each part is a normal,
// playable video named like "recording 2026-11-11 03-51-01.webm".
// -----------------------------------------------------

const SPLIT_KEY = 'recorderSplitMinutes';
let session = null;

(function addSplitPicker() {
  const label = document.createElement('label');
  label.innerHTML =
    'Split into parts every <select id="split">' +
    '<option value="0">Off (one file)</option>' +
    '<option value="2">2 minutes</option>' +
    '<option value="4">4 minutes</option>' +
    '<option value="5">5 minutes</option>' +
    '<option value="10">10 minutes</option>' +
    '<option value="15">15 minutes</option>' +
    '</select>';
  document.querySelector('.options').appendChild(label);
  ui.split = $('split');
  // Splitting starts on (4 minutes) for EO, and when the recorder is opened on its own.
  // Territory and the 3D Workflow app expect one video, so for them it starts Off.
  // The choice is remembered separately for each app.
  const q = new URLSearchParams(location.search);
  const mode = q.get('target') === '3dapps' ? (q.get('tool') === 'EO inbox' ? 'eo' : '3dapps') : q.get('territoryToken') ? 'territory' : 'eo';
  const key = mode === 'eo' ? SPLIT_KEY : SPLIT_KEY + ':' + mode;
  const fallback = mode === 'eo' ? '4' : '0';
  let saved = fallback;
  try { saved = localStorage.getItem(key) || fallback; } catch (e) {}
  ui.split.value = saved;
  if (!ui.split.value) ui.split.value = fallback;
  ui.split.onchange = () => { try { localStorage.setItem(key, ui.split.value); } catch (e) {} };

  const box = document.createElement('div');
  box.id = 'partsBox';
  box.className = 'hidden';
  box.innerHTML =
    '<h3 style="margin:16px 0 8px;font-size:1rem">Parts</h3>' +
    '<ol id="partsList" style="margin:0;padding-left:22px;line-height:1.9"></ol>' +
    '<button id="downloadAll" type="button" style="margin-top:10px">Download all parts</button>';
  ui.videoDownload.insertAdjacentElement('afterend', box);
  ui.partsBox = box;
  ui.partsList = $('partsList');
  $('downloadAll').onclick = downloadAllParts;
})();

function sessionStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + '-' + p(d.getMinutes());
}

function startRecording() {
  if (!stream) {
    say('Choose a tab or screen first.');
    return;
  }

  if (!window.MediaRecorder) {
    say('MediaRecorder is not supported by this browser.');
    return;
  }

  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  const mimeType =
    types.find(type => MediaRecorder.isTypeSupported(type));

  if (!mimeType) {
    say('This browser does not support WebM recording.');
    return;
  }

  const minutes = Number(ui.split.value) || 0;
  const prefix = (typeof recorderNamePrefix === 'function' && recorderNamePrefix()) || 'recording';

  session = {
    base: prefix + ' ' + sessionStamp(),
    mimeType,
    ext: mimeType.includes('mp4') ? '.mp4' : '.webm',
    minutes,
    part: 0,
    parts: [],
    splitTimer: null,
    stopped: false
  };

  ui.partsList.innerHTML = '';
  ui.partsBox.classList.add('hidden');
  ui.videoDownload.classList.add('hidden');

  try {
    recorder = newPartRecorder();
  } catch (err) {
    say(`Cannot record: ${err.message}`);
    session = null;
    controls();
    return;
  }

  if (minutes) {
    session.splitTimer = setInterval(nextPart, minutes * 60000);
  }

  started = Date.now();
  formatElapsed();
  ticker = setInterval(formatElapsed, 500);

  say(
    'Recording. Switch to the shared tab and continue working.' +
    (minutes ? ` A new part starts every ${minutes} minutes.` : '')
  );

  controls();
}

// one MediaRecorder per part
function newPartRecorder() {
  const s = session;
  const n = ++s.part;
  const bits = [];
  const r = new MediaRecorder(stream, {
    mimeType: s.mimeType,
    videoBitsPerSecond: 3500000
  });

  r.ondataavailable = event => {
    if (event.data.size > 0) bits.push(event.data);
  };

  r.onerror = event => {
    say(`Recording error: ${event.error?.message || 'unknown error'}`);
  };

  r.onstop = () => finishPart(s, n, bits, r.lastPart === true);

  r.start(1000);
  return r;
}

// close the current part and start the next one straight away
function nextPart() {
  if (!session || session.stopped || !stream) return;
  if (!recorder || recorder.state !== 'recording') return;

  const old = recorder;
  try {
    recorder = newPartRecorder();   // the new part starts before the old one stops, so nothing is lost
  } catch (err) {
    say(`Could not start part ${session.part + 1}: ${err.message}. This part keeps recording.`);
    return;
  }
  old.stop();
}

function endRecording() {
  if (session) {
    session.stopped = true;
    clearInterval(session.splitTimer);
    session.splitTimer = null;
  }

  if (recorder && recorder.state !== 'inactive') {
    recorder.lastPart = true;
    recorder.stop();
  }
}

function partName(s, n, last) {
  if (last && n === 1) return s.base + s.ext;   // never split: just one file
  return s.base + '-' + String(n).padStart(2, '0') + s.ext;
}

function finishPart(s, n, bits, last) {
  if (last) {
    clearInterval(ticker);
    ticker = null;
  }

  const blob = new Blob(bits, { type: s.mimeType });

  if (!blob.size) {
    if (last) {
      say(s.parts.length ? 'Recording stopped.' : 'No recording data was captured.');
      controls();
    }
    return;
  }

  const part = {
    n,
    blob,
    name: partName(s, n, last),
    last,
    url: URL.createObjectURL(blob),
    status: 'new',
    session: s.base
  };
  s.parts.push(part);
  s.parts.sort((a, b) => a.n - b.n);

  territoryVideoBlob = blob;   // the newest piece, for Territory's single-video button
  addPartRow(part);

  if (last) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = null;
    ui.playback.src = part.url;
    ui.videoDownload.href = part.url;
    ui.videoDownload.download = part.name;
    ui.videoDownload.textContent = s.parts.length > 1 ? 'Download last part' : 'Download video';
    ui.videoDownload.classList.remove('hidden');
    if (s.parts.length < 2) ui.partsBox.classList.add('hidden');
  }

  if (typeof partReady === 'function') partReady(part);

  if (last && !(typeof isLinked === 'function' && isLinked())) {
    say(s.parts.length > 1
      ? `Recording stopped: ${s.parts.length} parts. Download them below.`
      : 'Recording stopped. Download the video to save it.');
  }

  controls();
}

function addPartRow(part) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = part.url;
  a.download = part.name;
  a.textContent = 'Download';
  a.style.color = '#8fd3ff';
  const info = document.createElement('span');
  info.textContent = `Part ${part.n} · ${(part.blob.size / 1048576).toFixed(part.blob.size < 10485760 ? 1 : 0)} MB · `;
  const status = document.createElement('span');
  status.style.marginLeft = '8px';
  status.style.color = '#b9cbe3';
  li.append(info, a, status);
  part.row = { li, a, status };
  ui.partsList.appendChild(li);
  if (session && session.parts.length > 1 || !part.last) ui.partsBox.classList.remove('hidden');
}

function setPartStatus(part, text, color) {
  part.statusText = text;
  if (part.row) {
    part.row.status.textContent = text;
    part.row.status.style.color = color || '#b9cbe3';
  }
}

async function downloadAllParts() {
  if (!session || !session.parts.length) return say('Nothing recorded yet.');
  for (const p of session.parts) {
    if (!p.blob) continue;
    const a = document.createElement('a');
    a.href = p.url;
    a.download = p.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise(r => setTimeout(r, 700));
  }
  say('Downloading every part. If Chrome asks, allow multiple downloads.');
}


// -----------------------------------------------------
// STOP RECORDING
// -----------------------------------------------------

function stopRecording() {
  endRecording();
}


// -----------------------------------------------------
// CONVERT BLOB TO BASE64
// -----------------------------------------------------

function blobToBase64(blob) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload = () => {
        const result =
          String(reader.result);

        const marker = ';base64,';
const start = result.indexOf(marker);

if (start < 0) {
  reject(new Error('Could not encode the capture.'));
  return;
}

const base64 = result.slice(start + marker.length);

        resolve(base64);
      };

      reader.onerror = reject;

      reader.readAsDataURL(blob);
    }
  );
}


// -----------------------------------------------------
// CAPTURE SCREENSHOT
// -----------------------------------------------------

async function captureFrame() {
  pendingShot = null;

  const active =
    stream?.getVideoTracks()
      .some(track =>
        track.readyState === 'live'
      );

  if (!active) {
    say(
      'Sharing has ended. Choose a tab again.'
    );
    return;
  }

  try {
    const video =
      ui.live;

    if (video.readyState < 2) {
      await new Promise(
        (resolve, reject) => {

          const timeout =
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Video preview not ready'
                  )
                ),
              5000
            );

          video.addEventListener(
            'loadeddata',
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );
        }
      );
    }

    const width =
      video.videoWidth;

    const height =
      video.videoHeight;

    if (!width || !height) {
      throw new Error(
        'No video frame available'
      );
    }

    const canvas =
      document.createElement(
        'canvas'
      );

    canvas.width =
      width;

    canvas.height =
      height;

    const ctx =
      canvas.getContext('2d');

    ctx.drawImage(
      video,
      0,
      0,
      width,
      height
    );

    const blob =
      await new Promise(
        resolve => {
          canvas.toBlob(
            resolve,
            'image/png'
          );
        }
      );

    if (!blob) {
      throw new Error(
        'Could not create PNG'
      );
    }

    if (imageUrl) {
      URL.revokeObjectURL(
        imageUrl
      );
    }

    imageUrl =
      URL.createObjectURL(blob);

    ui.screenshot.src =
      imageUrl;

    ui.screenshot.hidden =
      false;

    lastScreenshotFilename =
      `screenshot-${stamp()}.png`;

    ui.imageDownload.href =
      imageUrl;

    ui.imageDownload.download =
      lastScreenshotFilename;

    ui.imageDownload.classList
      .remove('hidden');

    lastScreenshotBase64 =
      await blobToBase64(blob);

    say(
      'Screenshot captured. Download it or send it to Splice Bench.'
    );

    controls();

  } catch (err) {
    say(
      `Screenshot failed: ${err.message}`
    );
  }
}


// -----------------------------------------------------
// SCREENSHOT WITH OPTIONAL DELAY
// -----------------------------------------------------

function screenshot() {
  if (pendingShot) {
    return;
  }

  if (!stream) {
    say(
      'Choose a tab or screen first.'
    );
    return;
  }

  const delay =
    Number(ui.delay.value || 0);

  if (delay > 0) {
    say(
      `Screenshot in ${delay} seconds. Switch to the tab you want captured.`
    );

    pendingShot =
      setTimeout(
        captureFrame,
        delay * 1000
      );

  } else {
    captureFrame();
  }
}


// -----------------------------------------------------
// OPEN SPLICE BENCH
// -----------------------------------------------------

function openSpliceBench() {
  const url =
    String(
      ui.spliceUrl?.value || ''
    ).trim();

  if (!url) {
    say(
      'Enter your Splice Bench URL first.'
    );
    return;
  }

  localStorage.setItem(
    'spliceBenchUrl',
    url
  );

  spliceWindow =
    window.open(
      url,
      'spliceBench'
    );

  say(
    'Splice Bench opened.'
  );
}


// -----------------------------------------------------
// SEND SCREENSHOT TO SPLICE BENCH
// -----------------------------------------------------
 
function sendToSpliceBench() {

  if (!lastScreenshotBase64) {
    say('Take a screenshot first.');
    return;
  }

  if (!window.opener || window.opener.closed) {
    say(
      'Open this recorder from Splice Bench first.'
    );
    return;
  }

  const payload = {
    type: 'SPLICE_SCREENSHOT',
    territoryToken: new URLSearchParams(location.search).get('territoryToken') || '',

    filename:
      lastScreenshotFilename ||
      `screenshot-${stamp()}.png`,

    mimeType: 'image/png',

    base64: lastScreenshotBase64
  };

  try {

    window.opener.postMessage(
      payload,
      '*'
    );

    say(
      'Screenshot sent to Splice Bench.'
    );

  } catch (err) {

    say(
      'Could not send screenshot: ' +
      err.message
    );
  }
}
// -----------------------------------------------------
// EVENT LISTENERS
// -----------------------------------------------------

ui.share?.addEventListener(
  'click',
  chooseCapture
);

ui.record?.addEventListener(
  'click',
  startRecording
);

ui.stop?.addEventListener(
  'click',
  stopRecording
);

ui.shot?.addEventListener(
  'click',
  screenshot
);

ui.saveSpliceUrl?.addEventListener(
  'click',
  saveSpliceUrl
);

ui.openSplice?.addEventListener(
  'click',
  openSpliceBench
);

ui.sendSplice?.addEventListener(
  'click',
  sendToSpliceBench
);


// -----------------------------------------------------
// PAGE STARTUP / CLEANUP
// -----------------------------------------------------

window.addEventListener(
  'beforeunload',
  () => {

    if (stream) {
      stream
        .getTracks()
        .forEach(
          track => track.stop()
        );
    }

    if (videoUrl) {
      URL.revokeObjectURL(
        videoUrl
      );
    }

    if (imageUrl) {
      URL.revokeObjectURL(
        imageUrl
      );
    }
  }
);

loadSavedSpliceUrl();
controls();


// -----------------------------------------------------
// HANDOFF TO EO / TERRITORY
// Capture stays here on GitHub, outside Apps Script.
// Opened from EO (📥 Captures › 🎬 Recorder) each part is sent to the
// EO inbox by itself as soon as it is finished, one after another.
// -----------------------------------------------------

const handoff = (function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('territoryToken') || '';
  let targetOrigin = '*';
  try {
    const u = new URL(params.get('returnOrigin'));
    if (u.protocol === 'https:' && u.hostname.endsWith('.googleusercontent.com')) targetOrigin = u.origin;
  } catch (e) {}
  // Opened from EO or the 3D Workflow app: the video file itself is handed over (no size limit)
  const workflowTool = params.get('target') === '3dapps' ? (params.get('tool') || '') : '';
  const appName = workflowTool === 'EO inbox' ? 'EO' : workflowTool ? '3D Workflow' : 'Territory';
  return { token, targetOrigin, workflowTool, appName };
})();

function recorderNamePrefix() {
  const t = handoff.workflowTool;
  return !t || t === 'EO inbox' ? 'recording' : t + ' tutorial';
}

function isLinked() {
  return !!(handoff.workflowTool && handoff.token && window.opener && !window.opener.closed);
}

const sendButton = document.createElement('button');
sendButton.id = 'sendTerritoryVideo';
sendButton.type = 'button';
sendButton.textContent = handoff.workflowTool ? 'Send to ' + handoff.workflowTool + ' videos' : 'Send video to Territory';
sendButton.disabled = true;
ui.videoDownload.insertAdjacentElement('afterend', sendButton);

if (handoff.workflowTool) {
  say(
    'Linked to ' + handoff.appName + '. ' +
    'Record as long as you like: each part is sent to ' +
    (handoff.workflowTool === 'EO inbox' ? 'the EO 📥 Captures inbox' : handoff.workflowTool + ' videos') +
    ' by itself.'
  );
}

const outbox = [];
let sendingPart = null;
let sendWatch = null;

function unsentParts() {
  return session ? session.parts.filter(p => p.status === 'new' || p.status === 'error') : [];
}

function updateSendButton() {
  if (handoff.workflowTool) {
    const n = unsentParts().length;
    sendButton.disabled = !n;
    sendButton.textContent = n > 1
      ? `Send ${n} unsent parts to ${handoff.workflowTool} videos`
      : 'Send to ' + handoff.workflowTool + ' videos';
  } else {
    sendButton.disabled = !territoryVideoBlob;
  }
}

// called by finishPart() each time a part is closed
function partReady(part) {
  if (!handoff.workflowTool) return updateSendButton();
  if (!isLinked()) {
    part.status = 'error';
    setPartStatus(part, 'not sent: ' + handoff.appName + ' is not open (download it)', '#ffb4a8');
    if (part.last) say('Recording stopped. ' + handoff.appName + ' is not connected, so download the parts below.');
    return updateSendButton();
  }
  queuePart(part);
}

function queuePart(p) {
  if (p.status !== 'new' && p.status !== 'error') return;
  p.status = 'waiting';
  setPartStatus(p, 'waiting to send…');
  outbox.push(p);
  updateSendButton();
  pumpOutbox();
}

function pumpOutbox() {
  if (sendingPart || !outbox.length) return;
  if (!isLinked()) {
    outbox.splice(0).forEach(p => {
      p.status = 'error';
      setPartStatus(p, handoff.appName + ' window closed: download this part', '#ffb4a8');
    });
    say(handoff.appName + ' was closed, so some parts were not sent. Download them below.');
    return updateSendButton();
  }
  const p = outbox.shift();
  sendingPart = p;
  p.status = 'sending';
  setPartStatus(p, 'sending…');
  try {
    window.opener.postMessage({
      type: 'WORKFLOW_VIDEO',
      territoryToken: handoff.token,
      blob: p.blob,
      mimeType: p.blob.type,
      filename: p.name,
      tool: handoff.workflowTool,
      session: p.session,
      part: p.n,
      final: p.last
    }, handoff.targetOrigin);
  } catch (e) {
    return partFailed(p, e.message);
  }
  watchPart(p);
  updateSendButton();
}

// if the app never answers (page reloaded, closed), don't wait forever
function watchPart(p) {
  clearTimeout(sendWatch);
  sendWatch = setTimeout(() => {
    if (sendingPart === p && p.status === 'sending') partFailed(p, 'no answer from ' + handoff.appName);
  }, 180000);
}

function partSaved(p) {
  clearTimeout(sendWatch);
  p.status = 'saved';
  setPartStatus(p, '✓ saved to ' + handoff.appName, '#8ff0b5');
  if (!p.last) {
    // free the memory: it is safely in Drive now
    URL.revokeObjectURL(p.url);
    p.blob = null;
    p.row.a.removeAttribute('href');
    p.row.a.style.display = 'none';
  }
  if (sendingPart === p) sendingPart = null;
  const done = session.parts.filter(x => x.status === 'saved').length;
  if (session.stopped && done === session.parts.length) {
    say(done > 1
      ? `All ${done} parts are saved in ${handoff.workflowTool === 'EO inbox' ? 'the EO 📥 Captures inbox' : handoff.workflowTool + ' videos'}. You can close this window.`
      : 'Saved to ' + (handoff.workflowTool === 'EO inbox' ? 'the EO 📥 Captures inbox' : handoff.workflowTool + ' videos') + '. You can close this window.');
  } else if (!session.stopped) {
    say(`Recording… part ${p.n} saved to ${handoff.appName}. Keep going.`);
  } else {
    say(`Part ${p.n} saved (${done} of ${session.parts.length}). Keep this window open until all parts are saved.`);
  }
  updateSendButton();
  pumpOutbox();
}

function partFailed(p, why) {
  clearTimeout(sendWatch);
  p.status = 'error';
  setPartStatus(p, '⚠ ' + why + '. Press Send to try again, or download it.', '#ffb4a8');
  if (sendingPart === p) sendingPart = null;
  updateSendButton();
  pumpOutbox();
}

sendButton.onclick = async () => {
  if (handoff.workflowTool) {
    if (!window.opener || window.opener.closed) return say('Open this recorder from ' + handoff.appName + ' first, or download the parts.');
    if (!handoff.token) return say('Open this recorder using ' + handoff.appName + '’s recorder button.');
    const list = unsentParts();
    if (!list.length) return say('Nothing left to send.');
    list.forEach(queuePart);
    say('Sending ' + list.length + (list.length > 1 ? ' parts' : ' video') + ' to ' + handoff.appName + '… keep this window open.');
    return;
  }
  // Territory: a single small video, as before
  if (!territoryVideoBlob) return say('Record a video first.');
  if (!window.opener || window.opener.closed) return say('Open this recorder from Territory first.');
  if (!handoff.token) return say('Open this recorder using Territory’s video button.');
  sendButton.disabled = true;
  try {
    if (territoryVideoBlob.size > 20 * 1024 * 1024) return say('Video exceeds 20 MB. Download it and make a shorter recording.');
    window.opener.postMessage({
      type: 'TERRITORY_VIDEO',
      territoryToken: handoff.token,
      base64: await blobToBase64(territoryVideoBlob),
      mimeType: territoryVideoBlob.type,
      filename: ui.videoDownload.download || 'street.webm'
    }, handoff.targetOrigin);
    say('Video sent. Check Territory and click Save video.');
  } catch (e) {
    say('Unable to send: ' + e.message);
  } finally {
    updateSendButton();
  }
};

window.addEventListener('message', event => {
  const m = event.data;
  if (event.source !== window.opener || !handoff.token || m?.territoryToken !== handoff.token) return;
  if (handoff.targetOrigin !== '*' && event.origin !== handoff.targetOrigin) return;

  if (!handoff.workflowTool) {
    if (m.type === 'TERRITORY_RECEIVED') say('Territory received your capture. Return there to edit/save it.');
    if (m.type === 'TERRITORY_ERROR') say('Territory could not accept it: ' + m.message);
    return;
  }

  // which part is this about? (older app versions don't say: then it's the one being sent)
  const p = (m.part && session && session.parts.find(x => x.n === m.part && x.session === m.session)) || sendingPart;
  if (!p) {
    if (m.type === 'TERRITORY_ERROR') say(handoff.appName + ' could not accept it: ' + m.message);
    return;
  }
  if (m.type === 'TERRITORY_QUEUED') { watchPart(p); setPartStatus(p, 'in ' + handoff.appName + '’s queue…'); }
  if (m.type === 'TERRITORY_PROGRESS') { watchPart(p); setPartStatus(p, 'uploading ' + m.pct + '%'); }
  if (m.type === 'TERRITORY_RECEIVED') partSaved(p);
  if (m.type === 'TERRITORY_ERROR') partFailed(p, handoff.appName + ' could not accept it: ' + m.message);
});

window.addEventListener('beforeunload', e => {
  const busy = recorder?.state === 'recording' || sendingPart || outbox.length;
  if (busy) {
    e.preventDefault();
    e.returnValue = 'Parts are still recording or sending.';
  }
});
