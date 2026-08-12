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

/* ===================== TOPOLOGY MAP LOGIC ===================== */
// Dynamically update SVG lines to connect nodes accurately even on resize
function updateTopologyLines() {
  const core = document.getElementById('n-core');
  const n1 = document.getElementById('n-1');
  const n2 = document.getElementById('n-2');
  const n3 = document.getElementById('n-3');
  const n4 = document.getElementById('n-4');

  const l1 = document.getElementById('line1');
  const l2 = document.getElementById('line2');
  const l3 = document.getElementById('line3');
  const l4 = document.getElementById('line4');

  // Using percentages defined in CSS to draw the SVG paths
  l1.setAttribute('d', `M50%,50% L20%,30%`);
  l2.setAttribute('d', `M50%,50% L80%,30%`);
  l3.setAttribute('d', `M50%,50% L25%,80%`);
  l4.setAttribute('d', `M50%,50% L75%,80%`);
}

window.addEventListener('resize', updateTopologyLines);
updateTopologyLines();

/* ===================== SIMULATED SENSOR DATA ===================== */
// To make the dashboard feel "alive" as requested, we gently fluctuate the simulation values
const simTemp = document.getElementById('simTemp');
const simHum = document.getElementById('simHum');
const simVoc = document.getElementById('simVoc');

let currentTemp = 24.2;
let currentHum = 45.0;

setInterval(() => {
  // Fluctuate Temp by +/- 0.1
  const tempDiff = (Math.random() * 0.2 - 0.1);
  currentTemp += tempDiff;
  simTemp.textContent = `${currentTemp.toFixed(1)} °C`;

  // Fluctuate Humidity by +/- 0.5
  const humDiff = (Math.random() * 1.0 - 0.5);
  currentHum += humDiff;
  // Keep it constrained roughly
  if(currentHum > 55) currentHum = 55; 
  if(currentHum < 35) currentHum = 35;
  simHum.textContent = `${currentHum.toFixed(1)} %`;

  // Randomly flicker the VOC status very rarely
  if(Math.random() > 0.95) {
    simVoc.textContent = "Good";
    simVoc.style.color = "var(--color-healthy)";
  } else {
    simVoc.textContent = "Excellent";
    simVoc.style.color = ""; // fallback to text-aurora class
  }

}, 2500);