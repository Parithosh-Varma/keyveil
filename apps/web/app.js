const $ = (id) => document.getElementById(id);
const apiEl = $('api');
apiEl.value = localStorage.getItem('api_base') || 'http://127.0.0.1:8787';
apiEl.onchange = () => localStorage.setItem('api_base', apiEl.value);
const API = () => apiEl.value.replace(/\/$/, '');

$('save').onclick = async () => {
  const r = await fetch(API() + '/v1/secrets', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: $('sname').value, value: $('svalue').value }),
  }).then((r) => r.json());
  alert(JSON.stringify(r));
  $('svalue').value = '';
  loadSecrets();
};

async function loadSecrets() {
  const r = await fetch(API() + '/v1/secrets', { credentials: 'include' }).then((r) => r.json());
  $('slist').innerHTML = (r.secrets || []).map((s) => `<li>${s.name} <span class="muted">· ${s.updated_at || ''}</span></li>`).join('') || '<li class="muted">none</li>';
}

$('newkey').onclick = async () => {
  let ips = [];
  try { ips = $('kips').value ? JSON.parse($('kips').value) : []; } catch { alert('bad IP JSON'); return; }
  const r = await fetch(API() + '/v1/agent-keys', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: $('kname').value, scopes: ['github:create-repo', 'openai:chat'], ip_allowlist: ips, ttl_days: 90 }),
  }).then((r) => r.json());
  $('kout').textContent = JSON.stringify(r, null, 2);
};

$('tools').onclick = async () => {
  const r = await fetch(API() + '/v1/tools').then((r) => r.json());
  $('tout').textContent = JSON.stringify(r, null, 2);
};

$('audit').onclick = async () => {
  const r = await fetch(API() + '/v1/audit', { credentials: 'include' }).then((r) => r.json());
  $('aout').textContent = JSON.stringify(r, null, 2);
};

loadSecrets();
