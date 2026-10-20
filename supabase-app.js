(() => {
  const config = window.FQBOT_SUPABASE_CONFIG || {};
  const ready = Boolean(config.url && config.publishableKey && window.supabase?.createClient);
  const client = ready ? window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  }) : null;
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginScreen = document.getElementById('loginScreen');
  const appScreen = document.getElementById('appScreen');
  const adminScreen = document.getElementById('adminScreen');
  const notice = document.getElementById('loginNotice');
  const setupNote = document.getElementById('setupNote');
  const teacherButton = document.getElementById('teacherLoginButton');
  const label = document.querySelector('label[for="username"]');
  const usernamePattern = /^[a-z0-9._-]{3,32}$/;
  let teacherMode = false;
  let signedInUser = null;
  let selectedStudent = null;

  if (ready) {
    document.getElementById('loginHelp').innerHTML = '<strong>Alunos:</strong> entra com o nome de utilizador e a palavra-passe atribuídos pela professora.';
    document.querySelector('.composer-hint').textContent = 'A conversa fica guardada no histórico e pode ser consultada pela professora. Não partilhes dados pessoais.';
    document.querySelector('.privacy').textContent = 'As conversas ficam guardadas para revisão da professora. Não partilhes dados pessoais no chat.';
    const cloudNote = document.createElement('p');
    cloudNote.className = 'foot';
    cloudNote.style.maxWidth = '380px';
    cloudNote.textContent = 'As perguntas e respostas ficam associadas à conta do aluno para consulta pela professora.';
    document.querySelector('#loginScreen .login').appendChild(cloudNote);
  } else {
    document.getElementById('loginHelp').innerHTML = '<strong>Configuração em preparação:</strong> a professora irá ativar as contas de turma depois de ligar o FQBot ao Supabase.';
  }

  teacherButton.addEventListener('click', () => {
    teacherMode = !teacherMode;
    label.textContent = teacherMode ? 'Email da professora' : 'Nome de utilizador';
    usernameInput.type = teacherMode ? 'email' : 'text';
    usernameInput.autocomplete = teacherMode ? 'email' : 'username';
    usernameInput.placeholder = teacherMode ? 'Email usado na conta Supabase' : 'Nome de utilizador atribuído pela professora';
    teacherButton.textContent = teacherMode ? 'Entrar como aluno' : 'Área da professora';
    notice.textContent = '';
    if (!ready && teacherMode) {
      setupNote.textContent = 'A ligação ao Supabase ainda não está configurada. O acesso da professora ficará disponível quando o projeto for ligado.';
      setupNote.style.display = 'block';
    } else {
      setupNote.style.display = 'none';
    }
  });

  form.addEventListener('submit', event => {
    if (!ready) {
      if (teacherMode) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setupNote.textContent = 'A ligação ao Supabase ainda não está configurada. O acesso da professora ficará disponível quando o projeto for ligado.';
        setupNote.style.display = 'block';
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      setupNote.textContent = 'As contas ainda não estão ativas. A professora tem de ligar primeiro o projeto Supabase.';
      setupNote.style.display = 'block';
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void signIn();
  }, true);

  async function signIn() {
    notice.textContent = '';
    const identity = usernameInput.value.trim();
    if (!identity || !passwordInput.value) return;
    if (!teacherMode && !usernamePattern.test(identity.toLowerCase())) {
      notice.textContent = 'Escreve o nome de utilizador atribuído pela professora.';
      usernameInput.focus();
      return;
    }
    const email = teacherMode ? identity.toLowerCase() : identity.toLowerCase() + '@students.fqbot.invalid';
    const { data, error } = await client.auth.signInWithPassword({ email, password: passwordInput.value });
    if (error || !data.user) {
      notice.textContent = 'Não consegui iniciar sessão. Confirma os dados ou pede ajuda à professora.';
      passwordInput.focus();
      return;
    }
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('id, role, username, display_name').eq('id', data.user.id).maybeSingle();
    if (profileError || !profile) {
      await client.auth.signOut();
      notice.textContent = 'A conta ainda não está associada ao FQBot. Pede ajuda à professora.';
      return;
    }
    signedInUser = data.user;
    loginScreen.style.display = 'none';
    setupNote.style.display = 'none';
    if (profile.role === 'teacher') {
      adminScreen.hidden = false;
      await loadStudents();
      return;
    }
    if (profile.role !== 'student') {
      await client.auth.signOut();
      signedInUser = null;
      loginScreen.style.display = 'grid';
      notice.textContent = 'Esta conta não tem um perfil de aluno autorizado.';
      return;
    }
    document.getElementById('displayName').textContent = profile.display_name || profile.username;
    appScreen.style.display = 'grid';
    await loadStudentHistory(profile.id);
    if (!document.getElementById('messages').children.length) {
      window.FQBotAddMessage('bot', 'Olá! Sou o FQBot da professora Bernardete. Posso conversar e ajudar-te a estudar Físico-Química com a matéria dos PDFs.', true);
    }
    document.getElementById('chatInput').focus();
  }

  async function loadStudentHistory(userId) {
    const messages = document.getElementById('messages');
    messages.replaceChildren();
    const { data, error } = await client.from('chat_messages')
      .select('speaker, body').eq('user_id', userId).order('created_at', { ascending: true }).limit(200);
    if (error) {
      window.FQBotAddMessage('bot', 'Não consegui carregar o histórico agora. Podes continuar a estudar; avisa a professora se o problema continuar.', false);
      return;
    }
    for (const item of data || []) {
      window.FQBotAddMessage(item.speaker === 'student' ? 'user' : 'bot', item.body, false);
    }
  }

  document.addEventListener('fqbot:message', event => {
    if (!ready || !signedInUser || !appScreen || appScreen.style.display === 'none') return;
    const { role, text } = event.detail || {};
    if (typeof text !== 'string' || !text.trim()) return;
    if (role === 'user' && (/\b(password|palavra-passe|morada|telemovel|telefone|email)\b/i.test(text) || /\b\d{9}\b/.test(text))) return;
    void client.from('chat_messages').insert({
      user_id: signedInUser.id,
      speaker: role === 'user' ? 'student' : 'assistant',
      body: text.slice(0, 4000),
    });
  });

  document.getElementById('logoutButton').addEventListener('click', () => { void signOut(); });
  document.getElementById('teacherLogoutButton').addEventListener('click', () => { void signOut(); });
  async function signOut() {
    if (ready) await client.auth.signOut();
    signedInUser = null;
    selectedStudent = null;
    appScreen.style.display = 'none';
    adminScreen.hidden = true;
    loginScreen.style.display = 'grid';
    teacherMode = false;
    label.textContent = 'Nome de utilizador';
    usernameInput.type = 'text';
    usernameInput.autocomplete = 'username';
    usernameInput.placeholder = 'Nome de utilizador atribuído pela professora';
    teacherButton.textContent = 'Área da professora';
    document.getElementById('messages').replaceChildren();
    passwordInput.value = '';
    notice.textContent = '';
    usernameInput.focus();
  }

  async function manage(action, payload = {}) {
    const { data, error } = await client.functions.invoke('manage-students', { body: { action, ...payload } });
    if (error) {
      let message = error.message;
      try { message = (await error.context.json()).error || message; } catch { /* resposta sem JSON */ }
      throw new Error(message || 'Não foi possível concluir a operação.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadStudents() {
    const list = document.getElementById('studentList');
    list.replaceChildren();
    const { data, error } = await client.from('profiles').select('id, username, display_name')
      .eq('role', 'student').order('display_name', { ascending: true });
    if (error) {
      list.textContent = 'Não consegui carregar as contas. Confirma as regras de acesso do Supabase.';
      return;
    }
    if (!data?.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-status';
      empty.textContent = 'Ainda não há contas de alunos.';
      list.appendChild(empty);
      return;
    }
    for (const student of data) {
      const row = document.createElement('div');
      row.className = 'student-row';
      const info = document.createElement('div');
      const name = document.createElement('div'); name.className = 'student-name'; name.textContent = student.display_name;
      const login = document.createElement('div'); login.className = 'student-login'; login.textContent = 'Utilizador: ' + student.username;
      info.append(name, login);
      const actions = document.createElement('div'); actions.className = 'student-actions';
      const historyButton = makeButton('Ver histórico', 'secondary', () => { void loadHistory(student); });
      const passwordButton = makeButton('Nova palavra-passe', 'secondary', () => { openReset(student); });
      const deleteButton = makeButton('Eliminar', 'danger', () => { void deleteStudent(student); });
      actions.append(historyButton, passwordButton, deleteButton);
      row.append(info, actions);
      list.appendChild(row);
    }
  }

  function makeButton(text, style, action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'admin-button ' + style; button.textContent = text;
    button.addEventListener('click', action);
    return button;
  }

  async function loadHistory(student) {
    const panel = document.getElementById('historyPanel');
    const title = document.getElementById('historyTitle');
    const list = document.getElementById('historyList');
    panel.style.display = 'block';
    title.textContent = 'Histórico de ' + student.display_name + ' (' + student.username + ')';
    list.textContent = 'A carregar histórico…';
    const { data, error } = await client.from('chat_messages').select('speaker, body, created_at')
      .eq('user_id', student.id).order('created_at', { ascending: true }).limit(500);
    list.replaceChildren();
    if (error) { list.textContent = 'Não consegui abrir este histórico. Confirma as regras de acesso.'; return; }
    if (!data?.length) { list.textContent = 'Este aluno ainda não tem perguntas guardadas.'; return; }
    for (const item of data) {
      const entry = document.createElement('div'); entry.className = 'history-entry';
      const meta = document.createElement('div'); meta.className = 'history-meta';
      const date = new Date(item.created_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
      meta.textContent = (item.speaker === 'student' ? student.display_name : 'FQBot') + ' · ' + date;
      const body = document.createElement('div'); body.textContent = item.body;
      entry.append(meta, body); list.appendChild(entry);
    }
  }

  document.getElementById('createStudentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('createStudentStatus');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true; status.textContent = 'A criar conta…';
    try {
      const result = await manage('create', {
        displayName: document.getElementById('newStudentName').value.trim(),
        username: document.getElementById('newStudentUsername').value.trim().toLowerCase(),
        password: document.getElementById('newStudentPassword').value,
      });
      status.textContent = 'Conta criada para ' + result.student.display_name + '. Entrega o nome de utilizador e a palavra-passe em privado.';
      event.currentTarget.reset();
      await loadStudents();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });

  const resetDialog = document.getElementById('resetPasswordDialog');
  function openReset(student) {
    selectedStudent = student;
    document.getElementById('resetPasswordCaption').textContent = 'Define uma nova palavra-passe para ' + student.display_name + ' (' + student.username + ').';
    document.getElementById('resetPasswordInput').value = '';
    document.getElementById('resetPasswordStatus').textContent = '';
    resetDialog.showModal();
  }
  document.getElementById('cancelResetButton').addEventListener('click', () => resetDialog.close());
  document.getElementById('resetPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedStudent) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await manage('change_password', { userId: selectedStudent.id, password: document.getElementById('resetPasswordInput').value });
      document.getElementById('resetPasswordStatus').textContent = 'Palavra-passe alterada.';
      window.setTimeout(() => resetDialog.close(), 800);
    } catch (error) { document.getElementById('resetPasswordStatus').textContent = error.message; }
    finally { button.disabled = false; }
  });

  async function deleteStudent(student) {
    const accepted = window.confirm('Eliminar a conta de ' + student.display_name + ' e o respetivo histórico? Esta ação não pode ser anulada.');
    if (!accepted) return;
    try {
      await manage('delete', { userId: student.id });
      document.getElementById('historyPanel').style.display = 'none';
      await loadStudents();
    } catch (error) { window.alert(error.message); }
  }
})();

