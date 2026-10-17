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

  if (
    recorder &&
    recorder.state === 'recording'
  ) {
    recorder.stop();
  }

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
    `${String(secs).padStart(2, '0')}`;
}


// -----------------------------------------------------
// START RECORDING
// -----------------------------------------------------

function startRecording() {
  if (!stream) {
    say('Choose a tab or screen first.');
    return;
  }

  if (!window.MediaRecorder) {
    say(
      'MediaRecorder is not supported by this browser.'
    );
    return;
  }

  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  const mimeType =
    types.find(type =>
      MediaRecorder.isTypeSupported(type)
    );

  if (!mimeType) {
    say(
      'This browser does not support WebM recording.'
    );
    return;
  }

  chunks = [];

  try {
    recorder =
      new MediaRecorder(
        stream,
        {
          mimeType,
          videoBitsPerSecond: 3500000
        }
      );

    recorder.ondataavailable =
      event => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

    recorder.onerror =
      event => {
        say(
          `Recording error: ${
            event.error?.message ||
            'unknown error'
          }`
        );
      };

    recorder.onstop = () => {
      clearInterval(ticker);
      ticker = null;

      const blob =
        new Blob(
          chunks,
          { type: mimeType }
        );

      if (!blob.size) {
        say(
          'No recording data was captured.'
        );

        controls();
        return;
      }

      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      territoryVideoBlob=blob;
      if(document.getElementById('sendTerritoryVideo'))document.getElementById('sendTerritoryVideo').disabled=false;
      videoUrl =
        URL.createObjectURL(blob);

      ui.playback.src =
        videoUrl;

      ui.videoDownload.href =
        videoUrl;

      ui.videoDownload.download =
        `recording-${stamp()}.webm`;

      ui.videoDownload.classList
        .remove('hidden');

      say(
        'Recording stopped. Download the video to save it.'
      );

      controls();
    };

    recorder.start(1000);

    started = Date.now();

    formatElapsed();

    ticker =
      setInterval(
        formatElapsed,
        500
      );

    say(
      'Recording. Switch to the shared tab and continue working.'
    );

    controls();

  } catch (err) {
    say(
      `Cannot record: ${err.message}`
    );

    controls();
  }
}


// -----------------------------------------------------
// STOP RECORDING
// -----------------------------------------------------

function stopRecording() {
  if (
    recorder &&
    recorder.state === 'recording'
  ) {
    recorder.stop();
  }
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


// Territory video handoff. Capture remains here on GitHub, outside Apps Script.
(function(){
 const params=new URLSearchParams(location.search),token=params.get('territoryToken')||'';
 let targetOrigin='*';
 try{const u=new URL(params.get('returnOrigin'));if(u.protocol==='https:'&&u.hostname.endsWith('.googleusercontent.com'))targetOrigin=u.origin;}catch(e){}
 const button=document.createElement('button');button.id='sendTerritoryVideo';button.textContent='Send video to Territory';button.disabled=true;
 ui.videoDownload.insertAdjacentElement('afterend',button);
 button.onclick=async()=>{
  if(!territoryVideoBlob)return say('Record a video first.');
  if(!window.opener||window.opener.closed)return say('Open this recorder from Territory first.');
  if(!token)return say('Open this recorder using Territory’s video button.');
  if(territoryVideoBlob.size>20*1024*1024)return say('Video exceeds 20 MB. Download it and make a shorter recording.');
  button.disabled=true;
  try{window.opener.postMessage({type:'TERRITORY_VIDEO',territoryToken:token,base64:await blobToBase64(territoryVideoBlob),mimeType:territoryVideoBlob.type,filename:ui.videoDownload.download||'street.webm'},targetOrigin);say('Video sent. Check Territory and click Save video.');}
  catch(e){say('Unable to send: '+e.message);}finally{button.disabled=false;}
 };
 window.addEventListener('message',event=>{
  if(event.source!==window.opener||!token||event.data?.territoryToken!==token)return;
  if(targetOrigin!=='*'&&event.origin!==targetOrigin)return;
  if(event.data.type==='TERRITORY_RECEIVED')say('Territory received your capture. Return there to edit/save it.');
  if(event.data.type==='TERRITORY_ERROR')say('Territory could not accept it: '+event.data.message);
 });
})();
