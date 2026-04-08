    // ─── State ───────────────────────────────────────────────
let pc           = null;
let timerInterval = null;
let seconds      = 0;
let cameras      = JSON.parse(localStorage.getItem('rtsp-cameras') || '[]');
let camSlots     = []; // multi-cam peer connections

// ─── On Load ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const feed = document.getElementById('feed');
  feed.muted = true;
  feed.playsInline = true;

  const mtxHostInput = document.getElementById('mtxhost');
  const host = window.location.hostname;
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0') {
    mtxHostInput.value = host;
  }

  renderCameraList();
});

function normalizeMtxPath(path) {
  return path.replace(/[^A-Za-z0-9_.~/\-]/g, '');
}

// ─── Connect ─────────────────────────────────────────────
async function connect() {
  if (pc) { pc.close(); pc = null; }

  const ip      = document.getElementById('ip').value.trim();
  const port    = document.getElementById('port').value.trim();
  const user    = document.getElementById('user').value.trim();
  const pass    = document.getElementById('pass').value.trim();
  const path    = document.getElementById('path').value.trim();
  const mtxhost = document.getElementById('mtxhost').value.trim();

  if (!ip || !path) {
    setStatus('Fill in IP and Stream Path', 'error');
    return;
  }

  const rtspPort = port;

  const rtspUrl = user
    ? `rtsp://${user}:${pass}@${ip}${rtspPort ? `:${rtspPort}` : ''}/${path}`
    : `rtsp://${ip}${rtspPort ? `:${rtspPort}` : ''}/${path}`;
  const mtxPath = normalizeMtxPath(path);

  setStatus('⏳ Connecting...', 'connecting');
  setStat('statState', 'CONNECTING');

  const pathToken = encodeURIComponent(mtxPath.replace(/^\/+|\/+$/g, ''));
  const whepUrl = `http://${mtxhost}:8889/${pathToken}/whep`;

  pc = new RTCPeerConnection({
    iceServers: [],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  // Minimize jitter buffer for lowest latency
  const videoTransceiver = pc.addTransceiver('video', { direction: 'recvonly' });
  try {
    // Set jitter buffer target to minimal (not all browsers support this)
    videoTransceiver.receiver.jitterBufferTarget = 0;
  } catch (e) {
    console.log('⚠️ JitterBuffer tuning not supported on this browser');
  }
  
  pc.addTransceiver('audio', { direction: 'recvonly' });

  pc.ontrack = (e) => {
    const video = document.getElementById('feed');
    video.muted = true;
    const stream = video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream();
    stream.addTrack(e.track);
    video.srcObject = stream;
    video.classList.add('active');

    video.onloadedmetadata = () => {
      video.playbackRate = 1.0;  // Force normal playback speed (avoid jitter buffer buildup)
      video.play().then(() => {
        document.getElementById('overlayPlay').classList.remove('show');
      }).catch(() => {
        document.getElementById('overlayPlay').classList.add('show');
      });
    };

    // Show controls
    document.getElementById('videoControls').classList.add('active');
    document.getElementById('vcUrl').textContent = rtspUrl;

    // Hide idle screen
    document.getElementById('idleScreen').style.display = 'none';

    // Show disconnect button
    document.getElementById('btnDisconnect').style.display = 'flex';

    setStatus('🟢 Connected', 'connected');
    setStat('statState', 'LIVE');
    startTimer();
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      setStatus('❌ Connection lost', 'error');
      setStat('statState', 'LOST');
      stopTimer();
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    });

    if (!res.ok) throw new Error(`Stream not found (${res.status}). Is mediamtx running?`);

    const sdp = await res.text();
    await pc.setRemoteDescription({ type: 'answer', sdp });

  } catch (err) {
    setStatus('❌ ' + err.message, 'error');
    setStat('statState', 'ERROR');
    console.error(err);
  }
}

// ─── Disconnect ───────────────────────────────────────────
function disconnect() {
  if (pc) { pc.close(); pc = null; }

  const video = document.getElementById('feed');
  video.srcObject = null;
  video.classList.remove('active');

  document.getElementById('idleScreen').style.display = '';
  document.getElementById('videoControls').classList.remove('active');
  document.getElementById('btnDisconnect').style.display = 'none';
  document.getElementById('overlayPlay').classList.remove('show');

  setStatus('Disconnected', '');
  setStat('statState', 'IDLE');
  stopTimer();
}

// ─── Force Play ───────────────────────────────────────────
function forcePlay() {
  document.getElementById('feed').play().then(() => {
    document.getElementById('overlayPlay').classList.remove('show');
  });
}

// ─── Fullscreen ───────────────────────────────────────────
function toggleFullscreen() {
  const wrapper = document.getElementById('videoWrapper');
  if (!document.fullscreenElement) {
    wrapper.requestFullscreen().catch(console.error);
  } else {
    document.exitFullscreen();
  }
}

// ─── Screenshot ───────────────────────────────────────────
function takeScreenshot() {
  const video = document.getElementById('feed');
  if (!video.srcObject) return;

  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const dataUrl = canvas.toDataURL('image/png');
  document.getElementById('screenshotImg').src = dataUrl;
  document.getElementById('screenshotDownload').href = dataUrl;
  document.getElementById('screenshotModal').classList.add('open');
}

function closeModal() {
  document.getElementById('screenshotModal').classList.remove('open');
}

// ─── Save Camera ──────────────────────────────────────────
function saveCamera() {
  const ip   = document.getElementById('ip').value.trim();
  const port = document.getElementById('port').value.trim();
  const user = document.getElementById('user').value.trim();
  const pass = document.getElementById('pass').value.trim();
  const path = document.getElementById('path').value.trim();
  const mtxhost = document.getElementById('mtxhost').value.trim();

  if (!ip) { setStatus('Enter an IP to save', 'error'); return; }

  const name = prompt('Camera name:', ip);
  if (!name) return;

  cameras.push({ name, ip, port, user, pass, path, mtxhost });
  localStorage.setItem('rtsp-cameras', JSON.stringify(cameras));
  renderCameraList();
  setStatus('Camera saved!', 'connected');
}

function loadCamera(index) {
  const cam = cameras[index];
  document.getElementById('ip').value      = cam.ip;
  document.getElementById('port').value    = cam.port;
  document.getElementById('user').value    = cam.user;
  document.getElementById('pass').value    = cam.pass;
  document.getElementById('path').value    = cam.path;
  document.getElementById('mtxhost').value = cam.mtxhost;
}

function deleteCamera(index) {
  cameras.splice(index, 1);
  localStorage.setItem('rtsp-cameras', JSON.stringify(cameras));
  renderCameraList();
}

function renderCameraList() {
  const list = document.getElementById('cameraList');
  if (cameras.length === 0) {
    list.innerHTML = '<div class="empty-list">No saved cameras yet</div>';
    return;
  }
  list.innerHTML = cameras.map((cam, i) => `
    <div class="camera-item" onclick="loadCamera(${i})">
      <div>
        <div class="camera-item-name">${cam.name}</div>
        <div class="camera-item-ip">${cam.ip}:${cam.port}/${cam.path}</div>
      </div>
      <span class="camera-item-del" onclick="event.stopPropagation(); deleteCamera(${i})">✕</span>
    </div>
  `).join('');
}

// ─── Multi-Cam ────────────────────────────────────────────
function addCamSlot() {
  const ip      = prompt('Camera IP:');
  if (!ip) return;
  const port    = prompt('Port:', '8554');
  const path    = prompt('Stream path:', 'test');
  const mtxhost = prompt('mediamtx host:', 'localhost');

  const slotId  = 'slot-' + Date.now();
  const grid    = document.getElementById('multicamGrid');

  const slot = document.createElement('div');
  slot.className = 'cam-slot';
  slot.id = slotId;
  slot.innerHTML = `
    <div class="cam-slot-label">${ip}/${path}</div>
  `;
  grid.appendChild(slot);

  connectSlot(slot, ip, port, path, mtxhost);
}

async function connectSlot(slot, ip, port, path, mtxhost) {
  const pathToken = encodeURIComponent(normalizeMtxPath(path).replace(/^\/+|\/+$/g, ''));
  const whepUrl = `http://${mtxhost}:8889/${pathToken}/whep`;

  const slotPc = new RTCPeerConnection({
    iceServers: [],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  slotPc.addTransceiver('video', { direction: 'recvonly' });

  slotPc.ontrack = (e) => {
    const v = document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([e.track]);
    v.play().catch(() => {});
    slot.appendChild(v);
  };

  try {
    const offer = await slotPc.createOffer();
    await slotPc.setLocalDescription(offer);
    const res = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    });
    if (!res.ok) throw new Error('WHEP ' + res.status);
    const sdp = await res.text();
    await slotPc.setRemoteDescription({ type: 'answer', sdp });
  } catch (err) {
    slot.innerHTML = `<div class="cam-slot-label" style="color:#ff3d5a">Error</div>`;
    console.error(err);
  }

  camSlots.push(slotPc);
}

// ─── Timer ────────────────────────────────────────────────
function startTimer() {
  seconds = 0;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    setStat('statTime', `${m}:${s}`);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  setStat('statTime', '--:--');
}

// ─── Helpers ──────────────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (type || '');
}

function setStat(id, val) {
  document.getElementById(id).textContent = val;
}