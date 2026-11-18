const toast = document.getElementById('toast');
const refreshBtn = document.getElementById('refreshBtn');
const shareList = document.getElementById('shareList');
const listState = document.getElementById('listState');
const listStateText = document.getElementById('listStateText');
const stateSpinner = document.getElementById('stateSpinner');
const countEl = document.getElementById('shareCount');
const revokeModal = document.getElementById('revokeModal');
const revokeTitle = document.getElementById('revokeTitle');
const revokeMessage = document.getElementById('revokeMessage');
const revokeConfirm = document.getElementById('revokeConfirm');
const revokeCancel = document.getElementById('revokeCancel');
const clearAllBtn = document.getElementById('clearAllBtn');
const clearModal = document.getElementById('clearModal');
const clearMessage = document.getElementById('clearMessage');
const clearConfirm = document.getElementById('clearConfirm');
const clearCancel = document.getElementById('clearCancel');
const expiryModal = document.getElementById('expiryModal');
const expiryHint = document.getElementById('expiryHint');
const expiryOptions = document.getElementById('expiryOptions');
const expiryConfirm = document.getElementById('expiryConfirm');
const expiryCancel = document.getElementById('expiryCancel');
const expiryCustom = document.getElementById('expiryCustom');
const expiryDays = document.getElementById('expiryDays');

let shares = [];
let loading = false;
let revokeTarget = null;
let lastTrigger = null;
let toastTimer = null;
let clearingAll = false;
let expiryTarget = null;
let expiryTrigger = null;
let savingExpiry = false;

function showToast(message, duration = 3000) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('active');
  toastTimer = setTimeout(() => toast.classList.remove('active'), duration);
}

function formatDate(ms) {
  return ms ? new Date(ms).toLocaleString() : '—';
}

function shareUrl(token) {
  return new URL('/share/' + token, window.location.origin).href;
}

function showLoadingState() {
  listState.hidden = false;
  stateSpinner.hidden = false;
  listStateText.textContent = '加载分享链接...';
  removeLoginLink();
  shareList.hidden = true;
  clearAllBtn.hidden = true;
}

function removeLoginLink() {
  const old = document.getElementById('loginLink');
  if (old && old.parentNode === listState) listState.removeChild(old);
}

function showErrorState(message) {
  listState.hidden = false;
  stateSpinner.hidden = true;
  listStateText.textContent = message;
  shareList.hidden = true;
  clearAllBtn.hidden = true;
}

function showAuthState() {
  listState.hidden = false;
  stateSpinner.hidden = true;
  listStateText.textContent = '请先登录后查看你的分享链接';
  removeLoginLink();

  const link = document.createElement('a');
  link.id = 'loginLink';
  link.className = 'btn';
  link.href = '/';
  link.textContent = '去登录';
  listState.appendChild(link);

  shareList.hidden = true;
  countEl.textContent = '—';
  clearAllBtn.hidden = true;
}

function statusFor(share) {
  const now = Date.now();
  if (share.expired || (share.expire_at != null && share.expire_at <= now)) {
    return {
      label: '已过期',
      className: 'expired',
      meta: formatDate(share.expire_at) + ' 过期'
    };
  }
  if (share.expire_at == null) {
    return { label: '有效', className: 'active', meta: '长期有效' };
  }
  const days = Math.max(0, Math.ceil((share.expire_at - now) / 86400000));
  return {
    label: '有效',
    className: 'active',
    meta: '剩余 ' + days + ' 天 · ' + formatDate(share.expire_at) + ' 过期'
  };
}

function createShareRow(share) {
  const item = document.createElement('div');
  item.className = 'share-item';

  const info = document.createElement('div');
  info.className = 'share-info';

  const titleRow = document.createElement('div');
  titleRow.className = 'share-title-row';

  const title = document.createElement('div');
  title.className = 'share-title';
  title.textContent = share.notebook_title || '无标题笔记';
  title.title = title.textContent;

  const statusInfo = statusFor(share);
  const status = document.createElement('span');
  status.className = 'share-status ' + statusInfo.className;
  status.textContent = statusInfo.label;

  titleRow.appendChild(title);
  titleRow.appendChild(status);

  const meta = document.createElement('div');
  meta.className = 'share-meta';

  const expiry = document.createElement('span');
  expiry.textContent = statusInfo.meta;
  meta.appendChild(expiry);

  const linkRow = document.createElement('div');
  linkRow.className = 'share-link-row';

  const linkText = document.createElement('span');
  linkText.className = 'share-link-text';
  linkText.textContent = shareUrl(share.token);
  linkText.title = linkText.textContent;
  linkRow.appendChild(linkText);

  info.appendChild(titleRow);
  info.appendChild(meta);
  info.appendChild(linkRow);

  const actions = document.createElement('div');
  actions.className = 'share-actions';

  if (statusInfo.className !== 'expired') {
    const open = document.createElement('a');
    open.className = 'btn';
    open.href = shareUrl(share.token);
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = '打开';
    actions.appendChild(open);
  }

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = '复制链接';
  copy.addEventListener('click', () => copyLink(share));
  actions.appendChild(copy);

  const editExpiry = document.createElement('button');
  editExpiry.type = 'button';
  editExpiry.className = 'btn';
  editExpiry.textContent = '编辑有效期';
  editExpiry.setAttribute('aria-label', '编辑分享链接有效期');
  editExpiry.addEventListener('click', () => openExpiry(share, editExpiry));
  actions.appendChild(editExpiry);

  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'btn';
  revoke.textContent = '撤销';
  revoke.addEventListener('click', () => openRevoke(share, revoke));
  actions.appendChild(revoke);

  item.appendChild(info);
  item.appendChild(actions);
  return item;
}

function renderShares() {
  shareList.textContent = '';

  if (!shares.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = '还没有分享链接';

    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '在笔记里点击「分享」后，链接会出现在这里。';

    empty.appendChild(title);
    empty.appendChild(hint);
    shareList.appendChild(empty);
  } else {
    shares.forEach((share) => {
      shareList.appendChild(createShareRow(share));
    });
  }

  listState.hidden = true;
  shareList.hidden = false;
  clearAllBtn.hidden = shares.length === 0;
}

async function loadShares() {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  countEl.textContent = '—';
  showLoadingState();

  try {
    const res = await fetch('/api/shares', { credentials: 'same-origin' });

    if (res.status === 401) {
      showAuthState();
      return;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (error) {
      data = null;
    }

    if (!res.ok || !data || data.error) {
      showErrorState('加载失败：' + ((data && data.error) || 'HTTP ' + res.status));
      return;
    }

    if (data.storage === 'kv') {
      showErrorState('当前部署使用 KV 存储分享链接，无法列出');
      return;
    }

    shares = data.shares || [];
    countEl.textContent = shares.length + ' 条分享';
    renderShares();
  } catch (error) {
    showErrorState('加载失败：' + error.message);
  } finally {
    loading = false;
    refreshBtn.disabled = false;
  }
}

async function copyLink(share) {
  const url = shareUrl(share.token);
  try {
    await navigator.clipboard.writeText(url);
    showToast('已复制链接');
    return;
  } catch (error) {
    // 回退到临时 textarea
  }

  const temp = document.createElement('textarea');
  temp.value = url;
  temp.setAttribute('readonly', '');
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  const ok = document.execCommand && document.execCommand('copy');
  document.body.removeChild(temp);
  showToast(ok ? '已复制链接' : '复制失败，请手动复制');
}

function openRevoke(share, trigger) {
  revokeTarget = share;
  lastTrigger = trigger || null;
  revokeTitle.textContent = '撤销「' + share.notebook_title + '」的分享？';
  revokeMessage.textContent = '撤销后该链接会立即失效，已打开页面的人刷新后将无法查看。';
  revokeModal.classList.add('active');
  revokeModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => revokeCancel.focus(), 80);
}

function closeRevoke() {
  revokeModal.classList.remove('active');
  revokeModal.setAttribute('aria-hidden', 'true');
  revokeTarget = null;

  const trigger = lastTrigger;
  lastTrigger = null;
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
}

async function confirmRevoke() {
  if (!revokeTarget) return;

  const token = revokeTarget.token;
  const original = revokeConfirm.textContent;
  revokeConfirm.disabled = true;
  revokeConfirm.textContent = '撤销中...';

  try {
    const res = await fetch('/api/shares/' + encodeURIComponent(token), {
      method: 'DELETE',
      credentials: 'same-origin'
    });

    let data = null;
    try {
      data = await res.json();
    } catch (error) {
      data = null;
    }

    if (!res.ok || !data || !data.ok) {
      showToast('撤销失败：' + ((data && data.error) || 'HTTP ' + res.status));
      return;
    }

    closeRevoke();
    showToast('已撤销分享链接');
    await loadShares();
  } catch (error) {
    showToast('撤销失败：' + error.message);
  } finally {
    revokeConfirm.disabled = false;
    revokeConfirm.textContent = original;
  }
}

function openClearAll() {
  if (!shares.length) return;

  clearMessage.textContent =
    '确定删除你的全部 ' + shares.length + ' 条分享链接吗？删除后这些链接会立即失效，且无法恢复。';
  clearModal.classList.add('active');
  clearModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => clearCancel.focus(), 80);
}

function closeClearAll() {
  clearModal.classList.remove('active');
  clearModal.setAttribute('aria-hidden', 'true');
}

async function confirmClearAll() {
  if (clearingAll) return;

  clearingAll = true;
  const original = clearConfirm.textContent;
  clearConfirm.disabled = true;
  clearConfirm.textContent = '删除中...';

  try {
    const res = await fetch('/api/shares', {
      method: 'DELETE',
      credentials: 'same-origin'
    });

    let data = null;
    try {
      data = await res.json();
    } catch (error) {
      data = null;
    }

    if (!res.ok || !data || !data.ok) {
      showToast('删除失败：' + ((data && data.error) || 'HTTP ' + res.status));
      return;
    }

    closeClearAll();
    showToast(data.deleted > 0 ? `已删除 ${data.deleted} 条分享链接` : '没有可删除的分享链接');
    await loadShares();
  } catch (error) {
    showToast('删除失败：' + error.message);
  } finally {
    clearingAll = false;
    clearConfirm.disabled = false;
    clearConfirm.textContent = original;
  }
}

function expiryText(share) {
  if (share.expire_at == null) return '当前：长期有效';
  if (share.expire_at <= Date.now()) {
    return '当前：已过期（' + formatDate(share.expire_at) + '）';
  }
  return '当前：' + formatDate(share.expire_at) + ' 过期';
}

function openExpiry(share, trigger) {
  expiryTarget = share;
  expiryTrigger = trigger || null;

  const title = share.notebook_title || '无标题笔记';
  expiryHint.textContent = '为「' + title + '」设置新的有效期。' + expiryText(share);

  let preset = 'permanent';
  if (share.expire_at != null) {
    const remaining = Math.ceil((share.expire_at - Date.now()) / 86400000);
    if (remaining <= 14) preset = '7';
    else if (remaining <= 45) preset = '30';
    else preset = '90';
  }

  const radio = expiryOptions.querySelector('input[name="expiry"][value="' + preset + '"]');
  if (radio) radio.checked = true;

  expiryCustom.hidden = true;
  expiryDays.value = '';

  expiryModal.classList.add('active');
  expiryModal.setAttribute('aria-hidden', 'false');

  setTimeout(() => {
    const checked = expiryOptions.querySelector('input[name="expiry"]:checked');
    if (checked) checked.focus();
    else expiryCancel.focus();
  }, 80);
}

function closeExpiry() {
  expiryModal.classList.remove('active');
  expiryModal.setAttribute('aria-hidden', 'true');
  expiryTarget = null;

  const trigger = expiryTrigger;
  expiryTrigger = null;
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
}

async function confirmExpiry() {
  if (!expiryTarget || savingExpiry) return;

  const checked = expiryOptions.querySelector('input[name="expiry"]:checked');
  if (!checked) {
    showToast('请选择新的有效期');
    return;
  }

  const value = checked.value;
  let days;

  if (value === 'permanent') {
    days = null;
  } else if (value === 'custom') {
    const customDays = Number(expiryDays.value.trim());
    if (!Number.isInteger(customDays) || customDays < 1 || customDays > 365) {
      showToast('请输入 1-365 之间的天数');
      expiryDays.focus();
      return;
    }
    days = customDays;
  } else {
    days = Number(value);
  }

  const token = expiryTarget.token;
  const original = expiryConfirm.textContent;

  savingExpiry = true;
  expiryConfirm.disabled = true;
  expiryConfirm.textContent = '保存中...';

  try {
    const res = await fetch('/api/shares/' + encodeURIComponent(token), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days })
    });

    let data = null;
    try {
      data = await res.json();
    } catch (error) {
      data = null;
    }

    if (!res.ok || !data || !data.ok) {
      showToast('保存失败：' + ((data && data.error) || ('HTTP ' + res.status)));
      return;
    }

    closeExpiry();
    showToast('有效期已更新');
    await loadShares();
  } catch (error) {
    showToast('保存失败：' + error.message);
  } finally {
    savingExpiry = false;
    expiryConfirm.disabled = false;
    expiryConfirm.textContent = original;
  }
}

async function loadMe() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    const data = await res.json();
    if (data && data.user) {
      const pill = document.getElementById('accountName');
      pill.textContent = data.user.username;
      pill.hidden = false;
      return data.user;
    }
  } catch (error) {
    console.error('获取当前账号失败:', error);
  }
  return null;
}

async function init() {
  const user = await loadMe();
  if (!user) {
    showAuthState();
    return;
  }
  await loadShares();
}

refreshBtn.addEventListener('click', init);
document.getElementById('revokeClose').addEventListener('click', closeRevoke);
revokeCancel.addEventListener('click', closeRevoke);
revokeConfirm.addEventListener('click', confirmRevoke);

revokeModal.addEventListener('click', (event) => {
  if (event.target === revokeModal) closeRevoke();
});

clearAllBtn.addEventListener('click', openClearAll);
document.getElementById('clearClose').addEventListener('click', closeClearAll);
clearCancel.addEventListener('click', closeClearAll);
clearConfirm.addEventListener('click', confirmClearAll);

clearModal.addEventListener('click', (event) => {
  if (event.target === clearModal) closeClearAll();
});

document.getElementById('expiryClose').addEventListener('click', closeExpiry);
expiryCancel.addEventListener('click', closeExpiry);
expiryConfirm.addEventListener('click', confirmExpiry);

expiryOptions.addEventListener('change', () => {
  const checked = expiryOptions.querySelector('input[name="expiry"]:checked');
  const isCustom = !!(checked && checked.value === 'custom');
  expiryCustom.hidden = !isCustom;
  if (isCustom) expiryDays.focus();
});

expiryModal.addEventListener('click', (event) => {
  if (event.target === expiryModal) closeExpiry();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  if (expiryModal.classList.contains('active')) {
    closeExpiry();
  } else if (clearModal.classList.contains('active')) {
    closeClearAll();
  } else if (revokeModal.classList.contains('active')) {
    closeRevoke();
  }
});

init();
