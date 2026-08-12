/* ===================== NAV & DRAWER ===================== */
const drawer = document.getElementById('drawer');
document.getElementById('burger').addEventListener('click', () => drawer.classList.add('open'));
drawer.querySelector('.drawer-bg').addEventListener('click', () => drawer.classList.remove('open'));
drawer.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => drawer.classList.remove('open'))
);

/* ===================== QUICK ACTIONS ===================== */
window.triggerAction = function(btn) {
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Executing...';
  btn.style.opacity = '0.7';
  setTimeout(() => {
    btn.innerHTML = '✔ Done';
    btn.style.color = '#4ade80';
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.color = '';
      btn.style.opacity = '1';
    }, 1500);
  }, 600);
};

/* ===================== LIVE DATA SIMULATION ===================== */

// 1. Uptime Clock
const uptimeEl = document.getElementById('uptime');
let seconds = 50565; // ~14 hours
setInterval(() => {
  seconds++;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  uptimeEl.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}, 1000);

// 2. Sparklines Initialization & Update
function initSparkline(id, bars) {
  const container = document.getElementById(id);
  for(let i = 0; i < bars; i++) {
    const bar = document.createElement('div');
    bar.style.height = `${Math.random() * 100}%`;
    container.appendChild(bar);
  }
}

function updateSparkline(id) {
  const container = document.getElementById(id);
  const first = container.firstElementChild;
  container.removeChild(first);
  const newBar = document.createElement('div');
  // Bias based on ID for realism
  let height = 30 + Math.random() * 60;
  if (id === 'sparkVram') height = 80 + Math.random() * 20; // Keep VRAM high
  newBar.style.height = `${height}%`;
  container.appendChild(newBar);
}

initSparkline('sparkCpu', 20);
initSparkline('sparkGpu', 20);
initSparkline('sparkRam', 20);
initSparkline('sparkVram', 20);

// 3. Metric Updates Loop
async function updateSystemStats() {
  try {
    const response = await fetch("/api/system/current");
    const stats = await response.json();

    document.getElementById("cpuVal").textContent =
      `${Math.round(stats.cpuUsage)}%`;

    document.getElementById("gpuVal").textContent =
      `${Math.round(stats.gpuUsage)}%`;

    document.getElementById("ramVal").textContent =
      `${stats.ramUsage.toFixed(1)}%`;

    const vramPercent =
      (stats.vramUsage / stats.vramTotal) * 100;

    document.getElementById("vramVal").textContent =
      `${vramPercent.toFixed(0)}%`;

    document.getElementById("cpuTemp").textContent =
      stats.cpuTemp
        ? `${Math.round(stats.cpuTemp)}°C`
        : "--";

    document.getElementById("gpuTemp").textContent =
      `${Math.round(stats.gpuTemp)}°C`;

    document.getElementById("netUp").textContent =
      `${(stats.networkTxSpeed / 1024).toFixed(2)} MB/s`;

    document.getElementById("netDown").textContent =
      `${(stats.networkRxSpeed / 1024).toFixed(2)} MB/s`;

  } catch (err) {
    console.error("Telemetry Error:", err);
  }
}

updateSystemStats();

setInterval(
  updateSystemStats,
  1000
);

// 4. SVG Gauge Updates
// The stroke-dasharray format is "value, 100" (percentage)
// setInterval(() => {
//   // CPU Temp (around 65)
//   const cTemp = Math.floor(60 + Math.random() * 10);
//   document.getElementById('cpuTemp').textContent = `${cTemp}°C`;
//   const cpuGauge = document.querySelector('#cpuTemp').closest('.gauge').querySelector('.fill');
//   const cpuGauge =
//   document.querySelector("#cpuTemp")
//     .closest(".gauge")
//     .querySelector(".fill");

// cpuGauge.setAttribute(
//   "stroke-dasharray",
//   `${Math.min(stats.cpuTemp || 0,100)}, 100`
// );

//   // GPU Temp (around 82)
//   const gTemp = Math.floor(78 + Math.random() * 8);
//   document.getElementById('gpuTemp').textContent = `${gTemp}°C`;
//   const gpuGauge = document.querySelector('#gpuTemp').closest('.gauge').querySelector('.fill');
//   gpuGauge.setAttribute('stroke-dasharray', `${gTemp}, 100`);
// }, 3000);

// Update Services Card 

async function updateServices() {
  try {
    const response =
      await fetch("/api/system/services");

    const services =
      await response.json();

    const list =
      document.getElementById("serviceList");

    if (!list) return;

    list.innerHTML = services
      .map(
        (service) => `
      <li>
        <div class="ml-left">
          <span class="status-dot ${
            service.status === "running"
              ? "healthy"
              : "inactive"
          }"></span>
          <span class="ml-name">
            ${service.name}
          </span>
        </div>

        <span class="mono">
          ${service.status}
        </span>
      </li>
    `
      )
      .join("");

  } catch (err) {
    console.error(err);
  }
}

updateServices();

setInterval(
  updateServices,
  5000
);

//Processes Card

async function updateProcesses() {
  try {

    const response =
      await fetch("/api/system/processes");

    const processes =
      await response.json();

    const list =
      document.getElementById("processList");

    if (!list) return;

    list.innerHTML =
      processes
        .map(
          (p) => `
        <div class="process-row">
          <span class="process-name">
            ${p.name}
          </span>

          <span class="process-cpu">
            ${p.cpu}%
          </span>

          <span class="process-ram">
            ${p.ram} MB
          </span>
        </div>
      `
        )
        .join("");

  } catch (err) {
    console.error(err);
  }
}

updateProcesses();

setInterval(updateProcesses,3000);

//Storage Card

async function updateStorage() {
  try {

    const response =
      await fetch("/api/system/storage");

    const drives =
      await response.json();

    const list =
      document.getElementById("storageList");

    if (!list) return;

    list.innerHTML =
      drives.map((drive) => `
        <div class="storage-item">

          <div class="storage-head">
            <span>${drive.mount}</span>

            <span class="mono">
              ${drive.usagePercent.toFixed(0)}%
            </span>
          </div>

          <div class="storage-bar">
            <div
              class="storage-fill"
              style="
                width:${drive.usagePercent}%
              "
            ></div>
          </div>

        </div>
      `).join("");

  } catch (err) {
    console.error(err);
  }
}

updateStorage();

setInterval(
  updateStorage,
  15000
);

// 5. Terminal Event Stream
const terminal = document.getElementById('eventTerminal');
const events = [
  { type: 'INFO', msg: 'Model Llama-3-70B context cleared.' },
  { type: 'INFO', msg: 'Garbage collection cycle completed (142ms).' },
  { type: 'SUCCESS', msg: 'Image generated: n0th-8x9f-221 (4.2s).' },
  { type: 'WARN', msg: 'VRAM usage exceeded 90% threshold.' },
  { type: 'INFO', msg: 'Telemetry sync complete (ping: 2ms).' },
  { type: 'SUCCESS', msg: 'WebSocket reconnected on port 8080.' },
  { type: 'INFO', msg: 'Incoming Chatspace request: token_stream_start.' }
];

function addEvent() {
  if (terminal.childElementCount > 7) {
    terminal.removeChild(terminal.firstElementChild);
  }
  
  const ev = events[Math.floor(Math.random() * events.length)];
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  
  let typeSpan = '';
  if(ev.type === 'INFO') typeSpan = `<span class="t-info">[INFO]</span>`;
  if(ev.type === 'WARN') typeSpan = `<span class="t-warn">[WARN]</span>`;
  if(ev.type === 'SUCCESS') typeSpan = `<span class="t-success">[ OK ]</span>`;

  const html = `
    <div class="term-line">
      <span class="t-time">${time}</span>
      ${typeSpan}
      <span class="t-msg">${ev.msg}</span>
    </div>
  `;
  
  terminal.insertAdjacentHTML('beforeend', html);
}

// Initial populate
for(let i=0; i<5; i++) { addEvent(); }
// Live feed
setInterval(addEvent, 2500);