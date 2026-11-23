const STR = {"title":"cloudnote","newBtn":"新建","save":"保存","share":"分享","del":"删除","login":"登录/注册","myNotebooks":"我的笔记本","changePw":"修改密码","logout":"退出","noNotes":"请新建笔记本","clickHint":"请点左侧笔记本或新建","createHint":"请输入内容","confirmDelete":"确认删除？"};

/** D1 单行上限为 2 MB，这里留出余量。 */
const IMPORT_MAX_BYTES = 1.5 * 1024 * 1024;

/** 没有选中笔记时正文区的提示。 */
const EMPTY_EDITOR_HINT = '请先在左侧选择或新建笔记';

const menuBtn = document.getElementById('menuBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const accountMenu = document.getElementById('accountMenu');
const toast = document.getElementById('toast');
const importBtn = document.getElementById('importBtn');
const newBtn = document.getElementById('newBtn');
const saveBtn = document.getElementById('saveBtn');
const shareBtn = document.getElementById('shareBtn');
const myShareBtn = document.getElementById('myShareBtn');
const importInput = document.getElementById('importInput');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const listTitle = document.getElementById('listTitle');
const sidebarActions = document.getElementById('sidebarActions');
const notebookMenu = document.getElementById('notebookMenu');
const editorMenu = document.getElementById('editorMenu');
const tooltip = document.getElementById('tooltip');

/** 祭司：可查看所有笔记，但为只读角色（无新建/导入/编辑/删除/分享权限）。 */
function isPriest() {
  return Boolean(me && me.role === '祭司');
}

/** 根据角色切换写操作入口与编辑器只读状态。 */
function applyWritePermissions() {
  const readOnly = isPriest();
  if (importBtn) importBtn.hidden = readOnly;
  if (newBtn) newBtn.hidden = readOnly;
  if (saveBtn) saveBtn.hidden = readOnly;
  if (shareBtn) shareBtn.hidden = readOnly;
  if (myShareBtn) myShareBtn.hidden = readOnly;

  const shareAction = notebookMenu.querySelector('[data-action="share"]');
  const deleteAction = notebookMenu.querySelector('[data-action="delete"]');
  const menuDivider = notebookMenu.querySelector('.context-menu-divider');
  if (shareAction) shareAction.hidden = readOnly;
  if (deleteAction) deleteAction.hidden = readOnly;
  if (menuDivider) menuDivider.hidden = readOnly;
}

function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, duration);
}

function showShareLink(link, reused = false){
  return new Promise((resolve)=>{
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = '分享链接';
    header.appendChild(title);
    
    const body = document.createElement('div');
    body.className = 'modal-body';
    const msg = document.createElement('div');
    msg.className = 'message';
    msg.textContent = reused
      ? '这条笔记已有分享链接，继续使用原链接'
      : '分享链接（直接打开可查看）';
    const linkEl = document.createElement('div');
    linkEl.className = 'share-link';
    linkEl.textContent = link;
    body.appendChild(msg);
    body.appendChild(linkEl);
    
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.innerHTML = '<i class="material-icons">content_copy</i> 复制链接';
    copyBtn.onclick = async ()=>{
      try {
        await navigator.clipboard.writeText(link);
        showToast('已复制到剪贴板');
      } catch(e) {
        showToast('复制失败，请手动复制');
      }
    };
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-primary';
    closeBtn.textContent = '关闭';
    closeBtn.onclick = ()=>{
      backdrop.classList.remove('active');
      setTimeout(() => {
        document.body.removeChild(backdrop);
      }, 300);
      resolve();
    };
    footer.appendChild(copyBtn);
    footer.appendChild(closeBtn);
    
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    setTimeout(() => {
      backdrop.classList.add('active');
    }, 10);
  });
}

const api = {
  get: (p) => fetch('/api'+p, { credentials: 'same-origin' }).then(r=>r.json()).catch(err => {
    console.error('GET请求失败:', p, err);
    return { error: '网络错误' };
  }),
  post: (p, b) => fetch('/api'+p, {
    method:'POST',
    credentials:'same-origin',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(b)
  }).then(r=>r.json()).catch(err => {
    console.error('POST请求失败:', p, err);
    return { error: '网络错误' };
  }),
  put: (p, b) => fetch('/api'+p, {
    method:'PUT',
    credentials:'same-origin',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(b)
  }).then(r=>r.json()).catch(err => {
    console.error('PUT请求失败:', p, err);
    return { error: '网络错误' };
  }),
  del: (p) => fetch('/api'+p, {
    method:'DELETE',
    credentials:'same-origin'
  }).then(r=>r.json()).catch(err => {
    console.error('DELETE请求失败:', p, err);
    return { error: '网络错误' };
  })
};

let current = null;
let me = null;
let activeQuery = '';
let searchTimer = null;
let listRequestId = 0;
let menuTarget = null;
let editorSelection = { start: 0, end: 0 };
let pendingEditorSelection = null;
let suppressClickUntil = 0;
let openRequestId = 0;
let openingNotebookId = null;
let tooltipTimer = null;
let sidebarHintTimer = null;
let pointerX = 0;
let pointerY = 0;
let lastTooltipMove = 0;
let activeTooltipElement = null;

function showModal(options) {
  hideTooltip();
  return new Promise((resolve) => {
    let busy = false;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    if (options.title) {
      const header = document.createElement('div');
      header.className = 'modal-header';
      const title = document.createElement('div');
      title.className = 'modal-title';
      title.textContent = options.title;
      header.appendChild(title);
      modal.appendChild(header);
    }
    
    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof options.content === 'string') {
      const msg = document.createElement('div');
      msg.className = 'message';
      msg.textContent = options.content;
      body.appendChild(msg);
    } else if (options.content) {
      body.appendChild(options.content);
    }
    modal.appendChild(body);
    
    const actionButtons = [];
    if (options.actions) {
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      options.actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = action.primary ? 'btn btn-primary' : 'btn';
        btn.textContent = action.text;
        btn.onclick = async () => {
          if (btn.disabled || busy) return;

          if (typeof action.beforeClose === 'function') {
            busy = true;
            const originalText = btn.textContent;
            btn.disabled = true;
            if (action.busyText) btn.textContent = action.busyText;

            let canClose = false;
            try {
              canClose = await action.beforeClose({ button: btn, modal });
            } catch (error) {
              console.error('弹窗操作失败:', error);
              canClose = false;
            } finally {
              busy = false;
              btn.disabled = false;
              btn.textContent = originalText;
            }

            if (canClose === false) return;
          }

          backdrop.classList.remove('active');
          setTimeout(() => {
            document.body.removeChild(backdrop);
          }, 300);
          action.callback && action.callback();
          resolve(action.value);
        };
        actionButtons.push(btn);
        footer.appendChild(btn);
      });
      modal.appendChild(footer);
    }
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    if (typeof options.onReady === 'function') {
      options.onReady({ backdrop, modal, buttons: actionButtons });
    }
    
    if (options.closable !== false) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop && !busy) {
          backdrop.classList.remove('active');
          setTimeout(() => {
            document.body.removeChild(backdrop);
          }, 300);
          resolve(null);
        }
      });
    }
    
    setTimeout(() => {
      backdrop.classList.add('active');
    }, 10);
  });
}

function showModalConfirm(message, options = {}) {
  return showModal({
    title: options.title || '确认',
    content: message,
    actions: [
      { text: options.confirmText || '确定', primary: true, value: true },
      { text: '取消', value: false }
    ],
    onReady: options.onReady
  });
}

function showModalAlert(message) {
  return showModal({
    title: '提示',
    content: message,
    actions: [
      { text: '确定', primary: true }
    ]
  });
}

async function showAuthModal(prefillUsername = ''){
  let registrationEnabled = true;
  try {
    const res = await fetch('/api/registration', { credentials: 'same-origin', cache: 'no-store' });
    const status = await res.json();
    if (res.ok && status && typeof status.enabled === 'boolean') {
      registrationEnabled = status.enabled;
    }
  } catch (error) {
    console.error('获取注册开关失败:', error);
  }

  return new Promise((resolve)=>{
    const content = document.createElement('div');

    const tabs = document.createElement('div');
    tabs.className = 'auth-tabs';
    const btnLogin = document.createElement('button');
    btnLogin.type = 'button';
    btnLogin.textContent = '登录';
    btnLogin.className = 'active';
    const btnReg = document.createElement('button');
    btnReg.type = 'button';
    btnReg.textContent = '注册';
    tabs.appendChild(btnLogin);
    tabs.appendChild(btnReg);
    if (!registrationEnabled) {
      btnReg.hidden = true;
      tabs.hidden = true;
    }

    const regNote = document.createElement('p');
    regNote.className = 'auth-note';
    regNote.textContent = 'cloudnote暂未开放新用户注册';
    regNote.hidden = registrationEnabled;

    const fields = document.createElement('div');
    fields.className = 'auth-fields';

    const userField = document.createElement('div');
    userField.className = 'auth-field';
    const userInput = document.createElement('input');
    userInput.type = 'text';
    userInput.name = 'username';
    userInput.autocomplete = 'username';
    userInput.autocapitalize = 'off';
    userInput.spellcheck = false;
    userInput.placeholder = '用户名';
    if (prefillUsername) userInput.value = prefillUsername;
    userField.appendChild(userInput);

    const pwField = document.createElement('div');
    pwField.className = 'auth-field';
    const pwInput = document.createElement('input');
    pwInput.type = 'password';
    pwInput.name = 'password';
    pwInput.autocomplete = 'current-password';
    pwInput.placeholder = '密码';
    pwField.appendChild(pwInput);

    const captchaField = document.createElement('div');
    captchaField.className = 'auth-field captcha-field';
    captchaField.hidden = true;

    const captchaHead = document.createElement('div');
    captchaHead.className = 'captcha-head';
    const captchaLabel = document.createElement('label');
    captchaLabel.className = 'field-label';
    captchaLabel.htmlFor = 'captchaInput';
    captchaLabel.textContent = '验证码';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'captcha-refresh';
    refreshBtn.textContent = '换一张';
    captchaHead.appendChild(captchaLabel);
    captchaHead.appendChild(refreshBtn);

    const captchaRow = document.createElement('div');
    captchaRow.className = 'captcha-row';

    const captchaInput = document.createElement('input');
    captchaInput.id = 'captchaInput';
    captchaInput.type = 'text';
    captchaInput.name = 'captcha';
    captchaInput.autocomplete = 'off';
    captchaInput.autocapitalize = 'characters';
    captchaInput.spellcheck = false;
    captchaInput.maxLength = 6;
    captchaInput.placeholder = '输入 6 位验证码';
    captchaInput.setAttribute('data-lpignore', 'true');
    captchaInput.setAttribute('data-1p-ignore', '');

    const captchaImg = document.createElement('img');
    captchaImg.className = 'captcha-img';
    captchaImg.alt = '图片验证码';

    captchaRow.appendChild(captchaInput);
    captchaRow.appendChild(captchaImg);
    captchaField.appendChild(captchaHead);
    captchaField.appendChild(captchaRow);

    const errorEl = document.createElement('div');
    errorEl.className = 'form-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;

    fields.appendChild(userField);
    fields.appendChild(pwField);
    fields.appendChild(captchaField);
    fields.appendChild(errorEl);

    content.appendChild(tabs);
    content.appendChild(regNote);
    content.appendChild(fields);

    let mode = 'login';
    let captchaId = '';
    let captchaPromise = null;
    let modalTitleEl = null;

    function setError(message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }

    function refreshCaptcha(clearInput = false) {
      if (captchaPromise) return captchaPromise;

      captchaId = '';
      captchaImg.removeAttribute('src');
      captchaImg.alt = '验证码加载中';
      refreshBtn.disabled = true;
      if (clearInput) captchaInput.value = '';

      captchaPromise = (async () => {
        try {
          const res = await fetch('/api/captcha', { credentials: 'same-origin' });
          let data = null;
          try {
            data = await res.json();
          } catch (error) {
            data = null;
          }

          if (!res.ok || !data || !data.id || !data.image) {
            throw new Error((data && data.error) || '验证码加载失败');
          }

          captchaId = data.id;
          captchaImg.src = data.image;
          captchaImg.alt = '图片验证码，点击刷新';
          if (errorEl.textContent.includes('验证码加载失败')) setError('');
        } catch (error) {
          captchaImg.alt = '验证码加载失败，点击重试';
          setError('验证码加载失败，请点击「换一张」重试');
        } finally {
          captchaPromise = null;
          refreshBtn.disabled = false;
        }
      })();

      return captchaPromise;
    }

    function setMode(next) {
      mode = next;
      if (next === 'reg') {
        btnReg.classList.add('active');
        btnLogin.classList.remove('active');
        pwInput.autocomplete = 'new-password';
      } else {
        btnLogin.classList.add('active');
        btnReg.classList.remove('active');
        pwInput.autocomplete = 'current-password';
      }

      captchaField.hidden = next !== 'reg';
      if (modalTitleEl) modalTitleEl.textContent = next === 'reg' ? '注册' : '登录';
      setError('');
      if (next === 'reg' && !captchaId) refreshCaptcha();
    }

    btnLogin.addEventListener('click', () => setMode('login'));
    btnReg.addEventListener('click', () => setMode('reg'));
    captchaImg.addEventListener('click', () => refreshCaptcha(true));
    refreshBtn.addEventListener('click', () => refreshCaptcha(true));

    const modalPromise = showModal({
      title: '登录',
      content: content,
      actions: [
        {
          text: '提交',
          primary: true,
          value: 'submit',
          busyText: '提交中...',
          beforeClose: async () => {
            setError('');

            const username = userInput.value && userInput.value.trim();
            const password = pwInput.value && pwInput.value.trim();

            if (!username || !password) {
              setError('请完整填写用户名和密码');
              return false;
            }

            if (mode === 'reg') {
              if (!captchaId) {
                await refreshCaptcha(true);
                if (!captchaId) {
                  setError('验证码加载失败，请点击「换一张」重试');
                  return false;
                }
                setError('验证码已刷新，请重新输入');
                captchaInput.focus();
                return false;
              }

              const captchaCode = captchaInput.value && captchaInput.value.trim().toUpperCase();
              if (!captchaCode) {
                setError('请输入图片验证码');
                captchaInput.focus();
                return false;
              }
              if (captchaCode.length !== 6) {
                setError('请输入 6 位验证码');
                captchaInput.focus();
                return false;
              }

              const r = await api.post('/register', {
                username,
                password,
                captchaId,
                captchaCode
              });

              if (r.ok) {
                showToast('注册成功');
                resolve({ ok: true });
                return true;
              }

              const message = r.error || '注册失败';
              await refreshCaptcha(true);
              setError(message);
              captchaInput.focus();
              return false;
            }

            const r = await api.post('/login', { username, password });
            if (r.ok) {
              showToast('登录成功');
              resolve({ ok: true });
              return true;
            }

            setError(r.error || '登录失败');
            pwInput.focus();
            return false;
          }
        },
        { text: '取消' }
      ],
      onReady: ({ modal }) => {
        modalTitleEl = modal.querySelector ? modal.querySelector('.modal-title') : null;
      }
    });

    modalPromise.then((value) => {
      if (value !== 'submit') resolve(null);
    });

    setTimeout(() => {
      if (prefillUsername) pwInput.focus();
      else userInput.focus();
    }, 300);
  });
}

/* ------------------------------------------------------------------ 导入 TXT */

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 解码 txt：识别 BOM，优先 UTF-8，失败后回退 GB18030，
 * 以兼容 Windows 记事本保存的 ANSI 文本。
 */
function decodeTxt(buffer) {
  let bytes = new Uint8Array(buffer);

  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch (error2) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function normalizeTxt(text) {
  return text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
}

/** 导入前让用户确认笔记本名称，返回名称；取消返回 null。 */
function promptImportName(file, text) {
  const content = document.createElement('div');

  const fileCard = document.createElement('div');
  fileCard.className = 'import-file';
  const icon = document.createElement('i');
  icon.className = 'material-icons';
  icon.textContent = 'description';
  const info = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = file.name;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  const lines = text ? text.split('\n').length : 0;
  metaEl.textContent = formatFileSize(file.size) + ' · ' + lines + ' 行 · ' + text.length + ' 字符';
  info.appendChild(nameEl);
  info.appendChild(metaEl);
  fileCard.appendChild(icon);
  fileCard.appendChild(info);

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = 'importNameInput';
  label.textContent = '笔记本名称';

  const input = document.createElement('input');
  input.id = 'importNameInput';
  input.className = 'modal-input';
  input.type = 'text';
  input.maxLength = 80;
  input.autocomplete = 'off';
  input.name = 'notebook-title';
  input.placeholder = '给这个笔记本起个名字';
  input.value = file.name.replace(/\.txt$/i, '').trim().slice(0, 80) || '未命名笔记';

  const hint = document.createElement('div');
  hint.className = 'form-hint';
  hint.textContent = '导入后会立即创建笔记本，之后可随时继续编辑。';

  content.appendChild(fileCard);
  content.appendChild(label);
  content.appendChild(input);
  content.appendChild(hint);

  return showModal({
    title: '导入 TXT',
    content: content,
    actions: [
      { text: '取消' },
      { text: '导入', primary: true, value: true }
    ],
    onReady: ({ buttons }) => {
      const submit = buttons[1];
      const syncSubmit = () => {
        submit.disabled = !input.value.trim();
      };
      input.addEventListener('input', syncSubmit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!submit.disabled) submit.click();
        }
      });
      syncSubmit();
      setTimeout(() => {
        input.focus();
        input.select();
      }, 80);
    }
  }).then((result) => {
    if (!result) return null;
    return input.value.trim().slice(0, 80) || null;
  });
}

let importing = false;

async function importTxtFile(file) {
  if (importing || !file) return;

  if (!/\.txt$/i.test(file.name)) {
    showToast('仅支持 .txt 文本文件');
    return;
  }
  if (file.size > IMPORT_MAX_BYTES) {
    showToast('文件过大，最大支持 1.5 MB');
    return;
  }

  importing = true;
  try {
    const text = normalizeTxt(decodeTxt(await file.arrayBuffer()));
    if (!text.trim()) {
      showToast('文件内容为空');
      return;
    }
    // GBK 等编码转成 UTF-8 后体积会变大，按最终字节数再校验一次（D1 单行上限 2 MB）。
    if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
      showToast('文件过大，最大支持 1.5 MB');
      return;
    }

    if (!me) {
      await showModalAlert('导入前请先登录');
      const auth = await showAuthModal();
      if (!auth || !auth.ok) return;
      await initAuth();
      await refreshList();
    }

    const title = await promptImportName(file, text);
    if (!title) return;

    const res = await api.post('/notebooks', { title: title, content: text });
    if (!res || !res.ok || !res.id) {
      showToast((res && res.error) || '导入失败');
      return;
    }

    await openNotebook(res.id);
    resetSearch();
    await refreshList();
    if (window.innerWidth <= 768) toggleSidebar(false);
    showToast('已导入「' + title + '」');
  } catch (error) {
    console.error('导入 txt 失败:', error);
    showToast('导入失败：' + ((error && error.message) || '未知错误'));
  } finally {
    importing = false;
  }
}

function updateAccountArea(){
  const area = document.getElementById('accountArea');
  area.innerHTML = '';
  const signedOut = !(me && me.username);
  document.body.classList.toggle('signed-out', signedOut);
  const adminItem = document.getElementById('adminPanelItem');
  if (adminItem) adminItem.hidden = !(me && me.role === '皇帝');
  applyWritePermissions();
  if (signedOut) {
    accountMenu.classList.remove('active');
    if (document.activeElement === searchInput) searchInput.blur();
    hideTooltip();
    document.getElementById('titleInput').placeholder = '登录后查看';
    document.getElementById('content').placeholder = '登录后查看';
  } else if (!current) {
    setEditorEnabled(false);
  }
  
  if (me && me.username) {
    const btn = document.createElement('button');
    btn.className = 'account-btn';
    btn.textContent = me.username + (me.role ? (' (' + me.role + ')') : '');
    btn.id = 'accountBtn';
    btn.onclick = (e) => {
      e.stopPropagation();
      accountMenu.classList.toggle('active');
    };
    area.appendChild(btn);
  } else {
    const b = document.createElement('button');
    b.className = 'account-btn';
    b.id = 'authBtn';
    b.textContent = STR.login;
    b.onclick = async () => {
      const r = await showAuthModal();
      if (r && r.ok) {
        await initAuth();
        await refreshList();
      }
    };
    area.appendChild(b);
  }
}

async function initAuth() {
  const r = await api.get('/me');
  if (r && r.user) {
    me = r.user;
  } else {
    me = null;
  }
  updateAccountArea();
}

/** 清理登录态（退出登录、修改密码后强制重新登录时复用）。 */
function clearSignedInState() {
  me = null;
  current = null;
  resetSearch();
  document.getElementById('titleInput').value = '';
  document.getElementById('content').value = '';
  setEditorEnabled(false);
  updateAccountArea();
}

async function accountSettings() {
  if (!me) {
    await showModalAlert('未登录');
    return;
  }

  const content = document.createElement('div');

  const intro = document.createElement('p');
  intro.className = 'message';
  intro.textContent = '为保障账号安全，请先输入当前密码，再设置新密码。';

  const makeField = (labelText, id, autocomplete, placeholder) => {
    const field = document.createElement('div');
    field.className = 'auth-field';

    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;

    const input = document.createElement('input');
    input.id = id;
    input.name = id;
    input.type = 'password';
    input.autocomplete = autocomplete;
    input.placeholder = placeholder;

    field.appendChild(label);
    field.appendChild(input);
    return { field, input };
  };

  const oldField = makeField('当前密码', 'oldPassword', 'current-password', '请输入当前密码');
  const newField = makeField('新密码', 'newPassword', 'new-password', '请输入新密码');
  const confirmField = makeField('确认新密码', 'confirmPassword', 'new-password', '请再次输入新密码');

  const errorEl = document.createElement('div');
  errorEl.className = 'form-error';
  errorEl.hidden = true;

  const errorIcon = document.createElement('i');
  errorIcon.className = 'material-icons';
  errorIcon.textContent = 'error_outline';
  errorIcon.setAttribute('aria-hidden', 'true');

  const errorText = document.createElement('span');
  errorEl.appendChild(errorIcon);
  errorEl.appendChild(errorText);

  content.appendChild(intro);
  content.appendChild(oldField.field);
  content.appendChild(newField.field);
  content.appendChild(confirmField.field);
  content.appendChild(errorEl);

  const showError = (message) => {
    errorText.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorText.textContent = '';
  };

  let passwordChanged = false;
  let cancelButton = null;
  const setBusy = (busy) => {
    [oldField.input, newField.input, confirmField.input].forEach((input) => {
      input.disabled = busy;
    });
    if (cancelButton) cancelButton.disabled = busy;
  };

  await showModal({
    title: '修改密码',
    content,
    actions: [
      { text: '取消' },
      {
        text: '保存',
        primary: true,
        busyText: '保存中...',
        beforeClose: async () => {
          clearError();
          const oldPassword = oldField.input.value;
          const newPassword = newField.input.value;
          const confirmPassword = confirmField.input.value;

          if (!oldPassword) {
            showError('请输入当前密码');
            oldField.input.focus();
            return false;
          }
          if (!newPassword) {
            showError('请输入新密码');
            newField.input.focus();
            return false;
          }
          if (newPassword !== confirmPassword) {
            showError('两次输入的新密码不一致');
            confirmField.input.focus();
            return false;
          }

          setBusy(true);
          try {
            const res = await api.post('/change-password', { oldPassword, newPassword });
            if (res && res.ok) {
              passwordChanged = true;
              return true;
            }
            showError((res && res.error) || '修改失败，请重试');
            if (res && res.error === '原密码错误') oldField.input.focus();
            return false;
          } catch (error) {
            showError('修改失败：' + error.message);
            return false;
          } finally {
            setBusy(false);
          }
        }
      }
    ],
    onReady: ({ buttons }) => {
      cancelButton = buttons[0];
      const submitButton = buttons[1];
      const submit = () => {
        if (!submitButton.disabled) submitButton.click();
      };

      [oldField.input, newField.input, confirmField.input].forEach((input) => {
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        });
      });

      setTimeout(() => oldField.input.focus(), 80);
    }
  });

  if (!passwordChanged) return;

  const username = me ? me.username : '';
  clearSignedInState();
  await refreshList();
  showToast('密码已修改，请重新登录');

  const auth = await showAuthModal(username);
  if (auth && auth.ok) {
    await initAuth();
    await refreshList();
  }
}

function setListTitle(text) {
  if (listTitle) listTitle.textContent = text;
}

/** 把文本写入节点，并把 query 命中的片段用 <mark> 标出（全程 textContent，无注入风险）。 */
function appendHighlighted(parent, text, query) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!needle) {
    parent.appendChild(document.createTextNode(source));
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let cursor = 0;
  let hit = lowerSource.indexOf(lowerNeedle);

  if (hit < 0) {
    parent.appendChild(document.createTextNode(source));
    return;
  }

  while (hit >= 0) {
    if (hit > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, hit)));
    const mark = document.createElement('mark');
    mark.textContent = source.slice(hit, hit + needle.length);
    parent.appendChild(mark);
    cursor = hit + needle.length;
    hit = lowerSource.indexOf(lowerNeedle, cursor);
  }

  if (cursor < source.length) {
    parent.appendChild(document.createTextNode(source.slice(cursor)));
  }
}

function renderListPlaceholder({ icon, text, hint }) {
  const listEl = document.getElementById('list');
  listEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'empty-state fade-in';

  const iconEl = document.createElement('i');
  iconEl.className = 'material-icons empty-icon';
  iconEl.textContent = icon;

  const textEl = document.createElement('div');
  textEl.textContent = text;

  wrap.appendChild(iconEl);
  wrap.appendChild(textEl);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'empty-hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }

  listEl.appendChild(wrap);
}

function positionContextMenu(menu, x, y) {
  menu.hidden = false;
  const width = menu.offsetWidth || 180;
  const height = menu.offsetHeight || 160;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.classList.add('active');
  menu.setAttribute('aria-hidden', 'false');
}

function openNotebookMenu(notebook, x, y) {
  hideTooltip();
  closeEditorMenu();
  menuTarget = notebook;

  positionContextMenu(notebookMenu, x, y);

  const firstItem = notebookMenu.querySelector('.context-menu-item');
  if (firstItem) firstItem.focus({ preventScroll: true });
}

function closeNotebookMenu() {
  if (!notebookMenu || notebookMenu.hidden) return;
  notebookMenu.classList.remove('active');
  notebookMenu.hidden = true;
  notebookMenu.setAttribute('aria-hidden', 'true');
  menuTarget = null;
}

function openEditorMenu(x, y) {
  closeNotebookMenu();
  hideTooltip();

  const hasSelection = editorSelection.end > editorSelection.start;
  const cutItem = editorMenu.querySelector('[data-action="cut"]');
  const copyItem = editorMenu.querySelector('[data-action="copy"]');
  if (cutItem) cutItem.disabled = !hasSelection;
  if (copyItem) copyItem.disabled = !hasSelection;

  positionContextMenu(editorMenu, x, y);
}

function closeEditorMenu() {
  if (!editorMenu || editorMenu.hidden) return;
  editorMenu.classList.remove('active');
  editorMenu.hidden = true;
  editorMenu.setAttribute('aria-hidden', 'true');
}

/** 菜单打开期间重新聚焦正文并恢复选区（部分浏览器右键后会折叠选区）。 */
function restoreEditorSelection() {
  const textarea = document.getElementById('content');
  if (!textarea || textarea.disabled || !editorMenu || editorMenu.hidden) return;

  const max = textarea.value.length;
  const start = Math.max(0, Math.min(editorSelection.start, max));
  const end = Math.max(start, Math.min(editorSelection.end, max));

  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
}

/** 恢复右键时的选区，返回可用范围。 */
function focusEditorRange() {
  const textarea = document.getElementById('content');
  if (!textarea || textarea.disabled) return null;

  const max = textarea.value.length;
  const start = Math.max(0, Math.min(editorSelection.start, max));
  const end = Math.max(start, Math.min(editorSelection.end, max));

  textarea.focus();
  textarea.setSelectionRange(start, end);
  return { textarea, start, end };
}

/** 直接替换选区内容（execCommand 不可用时的兜底），并触发 input 事件。 */
function replaceEditorRange(start, end, text) {
  const textarea = document.getElementById('content');
  const value = textarea.value;
  textarea.value = value.slice(0, start) + text + value.slice(end);

  const caret = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function copyEditorSelection() {
  const range = focusEditorRange();
  if (!range || range.end <= range.start) {
    showToast('请先选中要复制的内容');
    return;
  }

  const text = range.textarea.value.slice(range.start, range.end);
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch (error) {
    const ok = document.execCommand && document.execCommand('copy');
    showToast(ok ? '已复制' : '复制失败，请使用 Ctrl+C');
  }
}

async function cutEditorSelection() {
  const range = focusEditorRange();
  if (!range || range.end <= range.start) {
    showToast('请先选中要剪切的内容');
    return;
  }

  const { textarea, start, end } = range;
  const text = textarea.value.slice(start, end);

  if (document.execCommand && document.execCommand('cut')) {
    showToast('已剪切');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    replaceEditorRange(start, end, '');
    showToast('已剪切');
  } catch (error) {
    showToast('剪切失败，请使用 Ctrl+X');
  }
}

async function pasteEditorSelection() {
  const range = focusEditorRange();
  if (!range) return;

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    const ok = document.execCommand && document.execCommand('paste');
    if (!ok) showToast('浏览器未允许读取剪贴板，请使用 Ctrl+V');
    return;
  }

  if (!text) {
    showToast('剪贴板为空');
    return;
  }

  const { textarea, start, end } = range;
  textarea.focus();
  textarea.setSelectionRange(start, end);

  const ok = document.execCommand && document.execCommand('insertText', false, text);
  if (!ok) {
    replaceEditorRange(start, end, text);
  } else {
    updateCharCount();
  }
  showToast('已粘贴');
}

function selectAllEditor() {
  const textarea = document.getElementById('content');
  if (!textarea || textarea.disabled) return;
  textarea.focus();
  textarea.select();
}

function selectNotebookItem(nb, el) {
  document.querySelectorAll('.notebook').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');

  // 已经是当前笔记就不重复加载，避免覆盖未保存的修改
  if (!current || current.id !== nb.id) openNotebook(nb.id);
}

function createNotebookItem(nb, index) {
  const el = document.createElement('div');
  el.className = 'notebook';
  el.style.animationDelay = `${index * 50}ms`;
  if (current && current.id === nb.id) el.classList.add('selected');

  const title = document.createElement('div');
  title.className = 'title';
  appendHighlighted(title, nb.title || '无标题', activeQuery);
  el.appendChild(title);

  const snippetText = (nb.snippet || '').trim();
  if (snippetText) {
    const snippet = document.createElement('div');
    snippet.className = 'snippet';
    appendHighlighted(snippet, snippetText, activeQuery);
    el.appendChild(snippet);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const metaParts = [];
  if (nb.author) metaParts.push(nb.author);
  if (nb.updated_at) metaParts.push(new Date(nb.updated_at).toLocaleString());
  if (nb.char_count !== null && nb.char_count !== undefined) {
    metaParts.push(formatCount(nb.char_count) + ' 字');
  }
  meta.textContent = metaParts.join(' · ');
  el.appendChild(meta);

  el.addEventListener('click', (event) => {
    // 长按刚打开右键菜单时，忽略随之而来的点击
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      if (event && event.stopPropagation) event.stopPropagation();
      return;
    }

    selectNotebookItem(nb, el);

    if (window.innerWidth <= 768) {
      toggleSidebar(false);
    }
  });

  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectNotebookItem(nb, el);
    openNotebookMenu(nb, event.clientX, event.clientY);
  });

  // 触屏长按同样打开菜单（右键在触屏上不可用）
  let pressTimer = null;
  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  el.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClickUntil = Date.now() + 700;
      selectNotebookItem(nb, el);
      openNotebookMenu(nb, touch.clientX, touch.clientY);
    }, 450);
  }, { passive: true });
  el.addEventListener('touchmove', cancelPress, { passive: true });
  el.addEventListener('touchend', cancelPress);
  el.addEventListener('touchcancel', cancelPress);

  setTimeout(() => {
    el.classList.add('slide-in');
  }, 10);

  return el;
}

async function refreshList() {
  closeNotebookMenu();
  const listEl = document.getElementById('list');
  const requestId = ++listRequestId;

  if (!me) {
    setListTitle('登录后查看笔记');
    renderListPlaceholder({
      icon: 'lock',
      text: '请先登录',
      hint: '登录后即可新建、导入和搜索笔记'
    });
    return;
  }

  listEl.innerHTML = '<div class="list-loading"><span class="loader"></span></div>';
  setListTitle(activeQuery ? '搜索结果' : '共 — 篇笔记');

  try {
    const path = activeQuery ? '/notebooks?q=' + encodeURIComponent(activeQuery) : '/notebooks';
    const res = await api.get(path);
    if (requestId !== listRequestId) return;

    if (res.error) {
      if (res.error === '未登录' && activeQuery) {
        renderListPlaceholder({ icon: 'lock', text: '登录后可以搜索笔记' });
      } else if (res.error === '未登录') {
        renderListPlaceholder({ icon: 'note_add', text: STR.noNotes });
      } else {
        renderListPlaceholder({ icon: 'error', text: res.error });
      }
      return;
    }

    const notebooks = res.notebooks || [];
    setListTitle(activeQuery ? `搜索结果 · ${notebooks.length}` : `共 ${notebooks.length} 篇笔记`);

    if (!notebooks.length) {
      if (activeQuery) {
        renderListPlaceholder({
          icon: 'search_off',
          text: `没有找到「${activeQuery}」`,
          hint: '换个关键词试试'
        });
      } else {
        renderListPlaceholder({ icon: 'note_add', text: STR.noNotes });
      }
      return;
    }

    listEl.innerHTML = '';
    notebooks.forEach((nb, index) => {
      listEl.appendChild(createNotebookItem(nb, index));
    });
  } catch (e) {
    if (requestId !== listRequestId) return;
    console.error('刷新列表失败:', e);
    renderListPlaceholder({ icon: 'error', text: '加载失败，请重试' });
  }
}

function updateSearchChrome() {
  const hasText = searchInput.value.trim().length > 0;
  if (searchClear) searchClear.hidden = searchInput.value.length === 0;
  // 搜索时隐藏「导入 / 新建」，把空间留给搜索结果标题
  if (sidebarActions) sidebarActions.hidden = hasText;
}

function applySearch() {
  clearTimeout(searchTimer);
  const value = searchInput.value.trim();
  updateSearchChrome();
  if (value === activeQuery) return;
  activeQuery = value;

  // 需要展示搜索结果：移动端展开抽屉，桌面展开目录
  if (activeQuery) {
    if (window.innerWidth <= 768) {
      if (!sidebar.classList.contains('open')) toggleSidebar(true);
    } else if (sidebar.classList.contains('collapsed')) {
      setSidebarCollapsed(false);
    }
  }

  refreshList();
}

function scheduleSearch() {
  updateSearchChrome();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applySearch, 220);
}

/** 清空搜索框与搜索状态（不发起请求）。 */
function resetSearch() {
  clearTimeout(searchTimer);
  if (searchInput) searchInput.value = '';
  updateSearchChrome();
  activeQuery = '';
}

/** 千分位显示字数。 */
function formatCount(value) {
  const count = Number(value);
  return (Number.isFinite(count) ? count : 0).toLocaleString('zh-CN');
}

function updateCharCount() {
  const el = document.getElementById('charCount');
  if (!el) return;
  el.textContent = formatCount(document.getElementById('content').value.length) + ' 字';
}

/** 没有选中笔记、或当前用户为只读角色时，禁用标题与正文的编辑。 */
function setEditorEnabled(enabled) {
  const titleInput = document.getElementById('titleInput');
  const contentInput = document.getElementById('content');
  const exportBtn = document.getElementById('exportBtn');
  const charCount = document.getElementById('charCount');

  // 祭司可以查看（含导出）所有笔记，但正文与标题保持只读。
  const editable = enabled && !isPriest();
  titleInput.disabled = !editable;
  contentInput.disabled = !editable;
  if (exportBtn) exportBtn.disabled = !enabled;
  if (charCount) {
    charCount.hidden = !enabled;
    if (!enabled) charCount.textContent = '0 字';
  }
  const signedOut = document.body.classList.contains('signed-out');
  titleInput.placeholder = editable
    ? '请输入标题'
    : (enabled && isPriest() ? '只读' : (signedOut ? '登录后查看' : '请点左侧笔记本或新建'));
  contentInput.placeholder = editable
    ? STR.createHint
    : (enabled && isPriest() ? '祭司为只读角色，无法编辑笔记' : (signedOut ? '登录后查看' : EMPTY_EDITOR_HINT));

  if (!enabled) ensureSidebarOpen();
  updateMenuButtonHint();
}

/** 生成安全的导出文件名：去掉路径分隔符、Windows 保留字符与结尾的点。 */
function safeExportName(title) {
  let base = String(title == null ? '' : title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.txt$/i, '')
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim();

  if (!base) return '无标题笔记';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = '_' + base;
  return base;
}

/** 弹出导出确认框，确认后下载。 */
function showExportConfirm(title, text, fromEditor) {
  const content = String(text || '');
  const fileName = safeExportName(title) + '.txt';
  const isEmpty = content.trim() === '';
  const lineCount = content
    ? content.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length
    : 0;

  const tail = fromEditor ? '；未保存的修改也会一并导出。' : '。';
  const message = isEmpty
    ? `当前笔记内容为空，确定要导出空文件「${fileName}」吗？`
    : `将导出「${fileName}」，共 ${lineCount} 行、${content.length} 字符${tail}`;

  showModalConfirm(message, {
    title: '导出笔记',
    confirmText: '导出',
    onReady: ({ buttons }) => {
      if (buttons[0]) buttons[0].focus();
    }
  }).then((ok) => {
    if (!ok) return;
    downloadTxtFile(fileName, content);
    showToast('已导出「' + fileName + '」');
  });
}

/**
 * 导出指定笔记：当前打开的笔记用编辑器内容（含未保存修改），
 * 其他笔记按 ID 拉取已保存的内容。
 */
async function requestExport(target) {
  if (!target) {
    showToast('请选中笔记本');
    return;
  }

  if (current && current.id === target.id) {
    const title = document.getElementById('titleInput').value || current.title || '';
    const text = document.getElementById('content').value || '';
    showExportConfirm(title, text, true);
    return;
  }

  try {
    const res = await api.get('/notebooks/' + target.id);
    if (!res || !res.notebook) {
      showToast((res && res.error) || '读取笔记失败');
      return;
    }
    showExportConfirm(res.notebook.title, res.notebook.content || '', false);
  } catch (error) {
    showToast('读取笔记失败: ' + error.message);
  }
}

/** 分享指定笔记（不要求先打开）。 */
async function shareNotebook(target, button) {
  if (!target) {
    showToast('请选中笔记本');
    return;
  }

  if (!me) {
    await showModalAlert('请先登录');
    const auth = await showAuthModal();
    if (!auth || !auth.ok) return;
    await initAuth();
    await refreshList();
  }

  const original = button ? button.innerHTML : '';
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="loader" style="width: 16px; height: 16px; border-width: 2px;"></span> 处理中...';
  }

  try {
    const res = await api.post('/notebooks/' + target.id + '/share');
    if (res && res.link) {
      await showShareLink(res.link, res.reused);
    } else {
      showToast((res && res.error) || '分享失败');
    }
  } catch (error) {
    showToast('分享失败: ' + error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

/** 删除指定笔记；如果删的是当前打开的笔记，同时清空并禁用编辑区。 */
async function deleteNotebook(target) {
  if (!target) {
    showToast('请选中笔记本');
    return;
  }
  if (!me) {
    showToast('请先登录');
    return;
  }

  const name = target.title || '无标题笔记';
  const ok = await showModalConfirm(`确定删除「${name}」吗？删除后无法恢复。`, {
    title: '删除笔记',
    confirmText: '删除'
  });
  if (!ok) return;

  try {
    const res = await api.del('/notebooks/' + target.id);
    if (!res || !res.ok) {
      showToast((res && res.error) || '删除失败');
      return;
    }

    if ((current && current.id === target.id) || openingNotebookId === target.id) {
      // 正在加载的笔记被删除时，作废这次加载，避免删除后又被回填
      if (openingNotebookId === target.id) {
        openRequestId += 1;
        openingNotebookId = null;
      }
      current = null;
      document.getElementById('titleInput').value = '';
      document.getElementById('content').value = '';
      setEditorEnabled(false);
    }

    await refreshList();
    showToast('已删除「' + name + '」');
  } catch (error) {
    showToast('删除失败: ' + error.message);
  }
}

function downloadTxtFile(fileName, text) {
  // 前置 BOM 方便 Windows 记事本识别 UTF-8；换行统一成 CRLF
  const body = '\uFEFF' + text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openNotebook(id) {
  const requestId = ++openRequestId;
  openingNotebookId = id;

  const titleInput = document.getElementById('titleInput');
  const contentInput = document.getElementById('content');
  
  titleInput.disabled = true;
  contentInput.disabled = true;
  titleInput.placeholder = '加载中...';
  
  try {
    const res = await api.get('/notebooks/' + id);
    if (requestId !== openRequestId) return;
    
    if (res.notebook) {
      current = res.notebook;
      
      titleInput.style.opacity = '0';
      contentInput.style.opacity = '0';
      
      setTimeout(() => {
        titleInput.value = current.title;
        contentInput.value = current.content;
        updateCharCount();
        
        titleInput.style.transition = 'opacity 0.3s ease';
        contentInput.style.transition = 'opacity 0.3s ease';
        titleInput.style.opacity = '1';
        contentInput.style.opacity = '1';
      }, 200);
    } else if (res.error) {
      if (res.error === '未登录') {
        await showModalAlert('请先登录');
        const ar = await showAuthModal();
        if (ar && ar.ok) {
          await initAuth();
          await refreshList();
        }
      } else {
        await showModalAlert(res.error);
      }
    }
  } catch (e) {
    if (requestId !== openRequestId) return;
    console.error('打开笔记失败:', e);
    await showModalAlert('加载失败: ' + e.message);
  } finally {
    if (requestId === openRequestId) {
      openingNotebookId = null;
      setEditorEnabled(Boolean(current));
    }
  }
}

function sidebarToggleLabel() {
  if (window.innerWidth <= 768) {
    return sidebar.classList.contains('open') ? '关闭目录' : '打开目录';
  }
  if (sidebar.classList.contains('collapsed')) return '展开目录';
  return current ? '收起目录' : '选择笔记后可收起目录';
}

function updateMenuButtonHint() {
  const label = sidebarToggleLabel();
  menuBtn.setAttribute('aria-label', label);
  if (tooltip && tooltip.classList.contains('active') && activeTooltipElement === menuBtn) {
    tooltip.textContent = label;
    positionTooltip(pointerX, pointerY);
  }
}

function positionTooltip(x, y) {
  if (!tooltip) return;
  const rect = tooltip.getBoundingClientRect();
  const gap = 14;
  let left = x + gap;
  let top = y + gap;

  // 靠近窗口右/下边缘时翻到指针另一侧，避免被裁掉
  if (left + rect.width + 8 > window.innerWidth) left = x - rect.width - gap;
  if (top + rect.height + 8 > window.innerHeight) top = y - rect.height - gap;

  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));

  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function showTooltip(text, source = null) {
  if (!tooltip) return;
  activeTooltipElement = source;
  lastTooltipMove = 0;
  tooltip.textContent = text;
  tooltip.classList.add('active');
  tooltip.setAttribute('aria-hidden', 'false');
  positionTooltip(pointerX, pointerY);
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  clearTimeout(sidebarHintTimer);
  activeTooltipElement = null;
  if (!tooltip) return;
  tooltip.classList.remove('active');
  tooltip.setAttribute('aria-hidden', 'true');
}

/** 给按钮绑定统一样式的悬停提示（跟随鼠标）。 */
function attachHoverTooltip(el, textOrGetter) {
  if (!el) return;

  el.addEventListener('mouseenter', (event) => {
    if (window.innerWidth <= 768) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    clearTimeout(tooltipTimer);
    clearTimeout(sidebarHintTimer);
    tooltipTimer = setTimeout(() => {
      if (el.disabled) return;
      const text = typeof textOrGetter === 'function' ? textOrGetter() : textOrGetter;
      if (text) showTooltip(text, el);
    }, 80);
  });

  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown', hideTooltip);
}

function setSidebarCollapsed(collapsed) {
  sidebar.classList.toggle('collapsed', collapsed);
  sidebar.inert = collapsed;
  if (collapsed) {
    sidebar.setAttribute('aria-hidden', 'true');
  } else {
    sidebar.removeAttribute('aria-hidden');
  }
  menuBtn.classList.toggle('active', !collapsed);
  menuBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  updateMenuButtonHint();
}

/** 桌面上目录被收起时重新展开（例如退出登录或没有笔记时）。 */
function ensureSidebarOpen() {
  if (window.innerWidth > 768 && sidebar.classList.contains('collapsed')) {
    setSidebarCollapsed(false);
  }
}

function toggleSidebar(forceState) {
  if (window.innerWidth <= 768) {
    const isOpen = sidebar.classList.contains('open');
    const shouldOpen = forceState !== undefined ? forceState : !isOpen;

    if (shouldOpen) {
      sidebar.classList.add('open');
      sidebarOverlay.classList.add('active');
      menuBtn.classList.add('active');
    } else {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
      menuBtn.classList.remove('active');
    }
    menuBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    updateMenuButtonHint();
    return;
  }

  // 桌面：收起 / 展开左侧目录；没有打开笔记时保持目录可见
  const collapsed = sidebar.classList.contains('collapsed');
  const shouldOpen = forceState !== undefined ? forceState : collapsed;

  if (!shouldOpen && !current) {
    if (collapsed) setSidebarCollapsed(false);
    return;
  }

  setSidebarCollapsed(!shouldOpen);
}

document.addEventListener('DOMContentLoaded', () => {
  setEditorEnabled(false);
  menuBtn.setAttribute('aria-expanded', window.innerWidth > 768 ? 'true' : 'false');
  // 桌面端目录默认展开，图标显示为 X
  menuBtn.classList.toggle('active', window.innerWidth > 768);

  document.getElementById('content').addEventListener('input', updateCharCount);

  menuBtn.addEventListener('click', () => {
    toggleSidebar();
  });

  attachHoverTooltip(menuBtn, sidebarToggleLabel);
  attachHoverTooltip(document.getElementById('exportBtn'), '导出为 TXT 文件');
  attachHoverTooltip(document.getElementById('shareBtn'), '生成分享链接');

  // 悬停目录栏时提示可以右键操作（未登录时不提示）
  sidebar.addEventListener('mouseenter', (event) => {
    if (document.body.classList.contains('signed-out')) return;
    if (window.innerWidth <= 768) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    clearTimeout(sidebarHintTimer);
    sidebarHintTimer = setTimeout(() => {
      if (!sidebar.classList.contains('collapsed')) {
        showTooltip('右键笔记可分享、导出或删除');
      }
    }, 500);
  });
  sidebar.addEventListener('mouseleave', hideTooltip);
  sidebar.addEventListener('mousedown', hideTooltip);
  sidebar.addEventListener('scroll', hideTooltip, true);

  // 提示显示期间跟随鼠标指针
  document.addEventListener('mousemove', (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!tooltip || !tooltip.classList.contains('active')) return;
    const now = Date.now();
    if (now - lastTooltipMove < 32) return;
    lastTooltipMove = now;
    positionTooltip(pointerX, pointerY);
  }, { passive: true });
  
  sidebarOverlay.addEventListener('click', () => {
    toggleSidebar(false);
  });

  searchInput.addEventListener('input', () => {
    // 浏览器自动填充可能在未聚焦时改动输入框，这类变化不应触发搜索
    if (document.activeElement !== searchInput) {
      searchInput.value = '';
      updateSearchChrome();
      return;
    }
    scheduleSearch();
  });

  // 点击搜索框空白处 / 图标 / 快捷键提示都能聚焦输入框
  const searchBox = document.querySelector('.search');
  if (searchBox) {
    searchBox.addEventListener('click', (event) => {
      const target = event.target;
      if (target && target.closest && target.closest('.search-clear')) return;
      searchInput.focus();
    });
  }

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applySearch();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const had = activeQuery || searchInput.value;
      resetSearch();
      searchInput.blur();
      if (had) refreshList();
    }
  });

  searchClear.addEventListener('click', () => {
    const had = activeQuery || searchInput.value;
    resetSearch();
    searchInput.focus();
    if (had) refreshList();
  });

  // Ctrl / Cmd + K 聚焦搜索框
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      if (document.body.classList.contains('signed-out')) return;
      if (document.querySelector('.modal-backdrop')) return;
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
  
  document.addEventListener('click', () => {
    accountMenu.classList.remove('active');
  });
  
  accountMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  notebookMenu.addEventListener('click', (event) => {
    const button = event.target.closest ? event.target.closest('.context-menu-item') : null;
    if (!button) return;

    const action = button.dataset ? button.dataset.action : button.getAttribute('data-action');
    const target = menuTarget;
    closeNotebookMenu();
    if (!target) return;

    if (action === 'share') shareNotebook(target);
    else if (action === 'export') requestExport(target);
    else if (action === 'delete') deleteNotebook(target);
  });

  editorMenu.addEventListener('click', (event) => {
    const button = event.target.closest ? event.target.closest('.context-menu-item') : null;
    if (!button || button.disabled) return;

    const action = button.dataset ? button.dataset.action : button.getAttribute('data-action');
    closeEditorMenu();

    if (action === 'copy') copyEditorSelection();
    else if (action === 'cut') cutEditorSelection();
    else if (action === 'paste') pasteEditorSelection();
    else if (action === 'select-all') selectAllEditor();
  });

  const contentTextarea = document.getElementById('content');

  // 右键按下时浏览器可能会折叠选区，先记下按下前的选区
  contentTextarea.addEventListener('mousedown', (event) => {
    if (event.button === 2) {
      pendingEditorSelection = {
        start: contentTextarea.selectionStart || 0,
        end: contentTextarea.selectionEnd || 0
      };
    }
  });

  contentTextarea.addEventListener('mouseup', (event) => {
    if (event.button === 2) restoreEditorSelection();
  });

  contentTextarea.addEventListener('contextmenu', (event) => {
    if (contentTextarea.disabled) return;

    // 移动端长按不弹出自定义的剪切/复制/粘贴菜单，交还给系统做文字选择。
    // 目录栏的长按菜单不受影响。
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) {
      closeEditorMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const current = {
      start: contentTextarea.selectionStart || 0,
      end: contentTextarea.selectionEnd || 0
    };
    if (
      current.end <= current.start &&
      pendingEditorSelection &&
      pendingEditorSelection.end > pendingEditorSelection.start
    ) {
      editorSelection = pendingEditorSelection;
    } else {
      editorSelection = current;
    }
    pendingEditorSelection = null;

    // 保持焦点在正文里，并在右键处理结束后恢复选区，避免高亮消失
    contentTextarea.focus();
    contentTextarea.setSelectionRange(editorSelection.start, editorSelection.end);
    // 菜单下移一点，避免盖住当前选中的文本行
    openEditorMenu(event.clientX, event.clientY + 32);
    setTimeout(restoreEditorSelection, 0);
  });

  contentTextarea.addEventListener('input', () => {
    closeEditorMenu();
  });

  // 点击菜单项时不抢走正文焦点，避免选中标记闪烁
  editorMenu.addEventListener('mousedown', (event) => {
    const item = event.target.closest ? event.target.closest('.context-menu-item') : null;
    if (item) event.preventDefault();
  });

  document.addEventListener('click', (event) => {
    if (notebookMenu && !notebookMenu.hidden && !notebookMenu.contains(event.target)) {
      closeNotebookMenu();
    }
    if (editorMenu && !editorMenu.hidden && !editorMenu.contains(event.target)) {
      closeEditorMenu();
    }
  });

  document.addEventListener('contextmenu', (event) => {
    if (notebookMenu && !notebookMenu.hidden) {
      if (notebookMenu.contains(event.target)) {
        event.preventDefault();
        return;
      }
      closeNotebookMenu();
    }
    if (editorMenu && !editorMenu.hidden) {
      if (editorMenu.contains(event.target)) {
        event.preventDefault();
        return;
      }
      closeEditorMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeNotebookMenu();
      closeEditorMenu();
    }
  });

  window.addEventListener('scroll', () => {
    closeNotebookMenu();
    closeEditorMenu();
  }, true);
  window.addEventListener('resize', () => {
    closeNotebookMenu();
    closeEditorMenu();
  });
  
  document.getElementById('changePwItem').addEventListener('click', async () => {
    accountMenu.classList.remove('active');
    await accountSettings();
  });

  document.getElementById('mySharesItem').addEventListener('click', () => {
    accountMenu.classList.remove('active');
    window.location.href = '/myshare';
  });

  document.getElementById('adminPanelItem').addEventListener('click', () => {
    accountMenu.classList.remove('active');
    window.location.href = '/admin';
  });
  
  document.getElementById('logoutItem').addEventListener('click', async () => {
    accountMenu.classList.remove('active');
    await api.post('/logout', {});
    clearSignedInState();
    await refreshList();
    showToast('已退出登录');
  });
  
  document.getElementById('importBtn').addEventListener('click', () => {
    importInput.value = '';
    importInput.click();
  });

  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (file) importTxtFile(file);
  });
  
  document.getElementById('newBtn').addEventListener('click', async () => {
    if (!me) {
      await showModalAlert('请先登录');
      const ar = await showAuthModal();
      if (!ar || !ar.ok) return;
    }
    
    const res = await api.post('/notebooks', { title: '新笔记本', content: '' });
    if (res.id) {
      resetSearch();
      await refreshList();
      openNotebook(res.id);
      showToast('已创建新笔记本');
    } else {
      showToast(res.error || '创建失败');
    }
  });
  
  document.getElementById('exportBtn').addEventListener('click', () => {
    requestExport(current);
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    if (!current) {
      return showToast('请选中笔记本');
    }
    
    if (!me) {
      await showModalAlert('请先登录');
      const ar = await showAuthModal();
      if (!ar || !ar.ok) return;
    }
    
    const title = document.getElementById('titleInput').value;
    const content = document.getElementById('content').value;
    
    const saveBtn = document.getElementById('saveBtn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="loader" style="width: 16px; height: 16px; border-width: 2px;"></span> 保存中...';
    
    try {
      const res = await api.put('/notebooks/' + current.id, { title, content });
      if (res.ok) {
        await refreshList();
        showToast('已保存');
      } else {
        if (res.error === '未登录') {
          await showModalAlert('请先登录');
          const ar = await showAuthModal();
          if (ar && ar.ok) {
            await initAuth();
            await refreshList();
          }
        } else {
          showToast(res.error || '保存失败');
        }
      }
    } catch (e) {
      showToast('保存失败: ' + e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }
  });
  
  document.getElementById('shareBtn').addEventListener('click', () => {
    shareNotebook(current, document.getElementById('shareBtn'));
  });
  
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
      const collapsed = sidebar.classList.contains('collapsed');
      menuBtn.classList.toggle('active', !collapsed);
      menuBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    } else {
      sidebar.classList.remove('collapsed');
      sidebar.inert = false;
      sidebar.removeAttribute('aria-hidden');
      sidebarOverlay.classList.remove('active');
      menuBtn.classList.remove('active');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
    updateMenuButtonHint();
  });
  
  (async () => {
    await initAuth();
    await refreshList();
  })().catch((err) => {
    console.error('初始化失败:', err);
    showToast('初始化失败，请刷新页面');
  });
});
