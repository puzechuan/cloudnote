const toast = document.getElementById('toast');
const modal = document.getElementById('actionModal');
const actionType = document.getElementById('actionType');
const expireDaysGroup = document.getElementById('expireDaysGroup');
const newRoleGroup = document.getElementById('newRoleGroup');
const actionHint = document.getElementById('actionHint');
const userIdInput = document.getElementById('userId');
const modalTitle = document.getElementById('modalTitle');
const submitBtn = document.getElementById('submitBtn');
const userList = document.getElementById('userList');
const listState = document.getElementById('listState');
const listStateText = document.getElementById('listStateText');
const stateSpinner = document.getElementById('stateSpinner');
const countEl = document.getElementById('userCount');
const refreshBtn = document.getElementById('refreshBtn');
const registrationSwitch = document.getElementById('registrationSwitch');
const registrationState = document.getElementById('registrationState');

const ACTION_LABELS = {
  'set-expire': '设置过期',
  'reset-password': '重置密码',
  'change-role': '修改角色',
  demote: '降级并清空',
  delete: '删除用户'
};

const ACTION_HINTS = {
  'set-expire': '账号将在指定天数后过期；过期且没有笔记时会被自动清理。',
  'reset-password': '密码会重置为 password123，请提醒用户登录后及时修改。',
  'change-role': '角色修改后立即生效。',
  demote: '该用户会被降为「骑士」，并清空全部笔记，操作不可撤销。',
  delete: '将永久删除该用户及其全部笔记与会话，操作不可撤销。'
};

const ROLE_CLASS = {
  皇帝: 'role-emperor',
  祭司: 'role-priest',
  贵族: 'role-noble',
  骑士: 'role-knight'
};

let currentUserId = '';
let lastTrigger = null;
let loading = false;
let savingSettings = false;
let toastTimer = null;

function showToast(message, duration = 3000) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('active');
  toastTimer = setTimeout(() => toast.classList.remove('active'), duration);
}

function showLoadingState(message = '加载用户列表...') {
  listState.hidden = false;
  stateSpinner.hidden = false;
  listStateText.textContent = message;
  userList.hidden = true;
}

function showErrorState(message) {
  listState.hidden = false;
  stateSpinner.hidden = true;
  listStateText.textContent = message;
  userList.hidden = true;
}

function firstChar(name) {
  const text = String(name || '').trim();
  return text ? Array.from(text)[0].toUpperCase() : '?';
}

function createUserRow(user) {
  const row = document.createElement('div');
  row.className = 'user-item';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = firstChar(user.username);
  avatar.setAttribute('aria-hidden', 'true');

  const info = document.createElement('div');
  info.className = 'user-info';

  const nameRow = document.createElement('div');
  nameRow.className = 'user-name';

  const name = document.createElement('span');
  name.className = 'name-text';
  name.textContent = user.username || '未命名用户';

  const badge = document.createElement('span');
  badge.className = 'role-badge ' + (ROLE_CLASS[user.role] || 'role-knight');
  badge.textContent = user.role || '骑士';

  nameRow.appendChild(name);
  nameRow.appendChild(badge);

  const meta = document.createElement('div');
  meta.className = 'user-meta';
  meta.textContent = 'ID ' + user.id;
  meta.title = user.id;

  info.appendChild(nameRow);
  info.appendChild(meta);

  const action = document.createElement('button');
  action.className = 'btn user-action';
  action.type = 'button';
  action.textContent = '操作';
  action.setAttribute('aria-label', '操作用户 ' + (user.username || ''));
  action.addEventListener('click', () => openModal(user, action));

  row.appendChild(avatar);
  row.appendChild(info);
  row.appendChild(action);
  return row;
}

function createEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const title = document.createElement('div');
  title.className = 'empty-title';
  title.textContent = '暂无其他用户';

  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.textContent = '普通用户注册后会出现在这里。';

  wrap.appendChild(title);
  wrap.appendChild(hint);
  return wrap;
}

function renderUsers(users) {
  userList.textContent = '';
  if (!users.length) {
    userList.appendChild(createEmptyState());
    return;
  }
  users.forEach((user) => {
    userList.appendChild(createUserRow(user));
  });
}

async function loadUserList() {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  countEl.textContent = '—';
  showLoadingState();

  try {
    const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
    const result = await res.json();

    if (result.error) {
      showErrorState('加载失败：' + result.error);
      return;
    }

    const users = (result.users || []).filter((user) => user.role !== '皇帝');
    countEl.textContent = users.length + ' 位用户';
    renderUsers(users);
    listState.hidden = true;
    userList.hidden = false;
  } catch (error) {
    showErrorState('加载失败：' + error.message);
  } finally {
    loading = false;
    refreshBtn.disabled = false;
  }
}

function renderRegistrationState(enabled) {
  registrationSwitch.checked = enabled;
  registrationState.textContent = enabled ? '已开启' : '已关闭';
  registrationState.classList.toggle('is-on', enabled);
}

async function loadSettings() {
  registrationSwitch.disabled = true;
  registrationState.textContent = '加载中...';
  registrationState.classList.remove('is-on');

  let loaded = false;
  try {
    const res = await fetch('/api/admin/settings', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const result = await res.json();

    if (!res.ok || result.error) {
      throw new Error(result.error || 'HTTP ' + res.status);
    }

    renderRegistrationState(!!result.registrationEnabled);
    loaded = true;
  } catch (error) {
    registrationState.textContent = '加载失败';
    showToast('加载注册设置失败：' + error.message, 5000);
  } finally {
    registrationSwitch.disabled = !loaded;
  }
}

async function saveRegistrationSetting() {
  if (savingSettings) return;

  const next = registrationSwitch.checked;
  const previous = !next;
  savingSettings = true;
  registrationSwitch.disabled = true;
  registrationState.textContent = '保存中...';
  registrationState.classList.remove('is-on');

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ registrationEnabled: next })
    });
    const result = await res.json();

    if (!res.ok || !result.ok) {
      throw new Error(result.error || 'HTTP ' + res.status);
    }

    renderRegistrationState(!!result.registrationEnabled);
    showToast(next ? '已开启新用户注册' : '已关闭新用户注册');
  } catch (error) {
    renderRegistrationState(previous);
    showToast('保存注册设置失败：' + error.message, 5000);
  } finally {
    savingSettings = false;
    registrationSwitch.disabled = false;
  }
}

function openModal(user, trigger) {
  currentUserId = user.id;
  lastTrigger = trigger || null;
  modalTitle.textContent = user.username || '操作用户';
  userIdInput.value = user.id;
  actionType.value = 'set-expire';
  toggleActionGroups();
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => actionType.focus(), 80);
}

function closeModal() {
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  currentUserId = '';

  const trigger = lastTrigger;
  lastTrigger = null;
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
}

function toggleActionGroups() {
  const action = actionType.value;
  expireDaysGroup.hidden = action !== 'set-expire';
  newRoleGroup.hidden = action !== 'change-role';
  submitBtn.textContent = ACTION_LABELS[action] || '确认操作';
  actionHint.textContent = ACTION_HINTS[action] || '';
}

function setSubmitting(active) {
  submitBtn.disabled = active;
  submitBtn.textContent = active
    ? '处理中...'
    : ACTION_LABELS[actionType.value] || '确认操作';
}

async function submitAction() {
  if (!currentUserId || submitBtn.disabled) return;

  const action = actionType.value;
  const payload = { action };

  if (action === 'set-expire') {
    const days = Number.parseInt(document.getElementById('expireDays').value, 10);
    if (!Number.isFinite(days) || days < 1) {
      showToast('请输入有效的过期天数');
      return;
    }
    payload.days = days;
  } else if (action === 'reset-password') {
    payload.newPassword = 'password123';
  } else if (action === 'change-role') {
    payload.role = document.getElementById('newRole').value;
  }

  setSubmitting(true);
  try {
    const res = await fetch(`/api/admin/users/${currentUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (!result.ok) {
      showToast('操作失败：' + (result.error || '未知错误'), 5000);
      return;
    }

    const newPassword = result.newPassword;
    closeModal();
    await loadUserList();
    showToast(
      newPassword ? '密码已重置为 ' + newPassword : '操作成功',
      newPassword ? 6000 : 3000
    );
  } catch (error) {
    showToast('请求失败：' + error.message, 5000);
  } finally {
    setSubmitting(false);
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
    }
  } catch (error) {
    console.error('获取当前账号失败:', error);
  }
}

actionType.addEventListener('change', toggleActionGroups);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
submitBtn.addEventListener('click', submitAction);
registrationSwitch.addEventListener('change', saveRegistrationSetting);
refreshBtn.addEventListener('click', () => {
  loadSettings();
  loadUserList();
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal.classList.contains('active')) {
    closeModal();
  }
});

loadMe();
loadSettings();
loadUserList();
