import { renderMarkdown, renderMarkdownPreview, escapeHtml } from './markdown.js';

const AVATAR_COLORS = [
  ['#2eb67d', '🐝'],
  ['#4a90e2', '🤖'],
  ['#e01e5a', '🌸'],
  ['#ecb22e', '🍯'],
  ['#7c5cff', '🧠'],
  ['#36c5f0', '⚡'],
];

const state = {
  viewMode: 'channel', // 'channel' | 'dm' | 'inbox'
  currentChannelId: null,
  currentChannel: null,
  currentSessionId: null,
  currentSessionName: 'Welcome',
  currentModel: null,
  defaultModelId: null,
  userPickedModel: false,
  availableModels: [],
  pendingImages: [],
  channels: [],
  sessions: [],
  personas: [],
  activeAgentAuthor: null,
  settingsTab: 'global',
  settingsAgentId: null,
  allTools: [],
  replyTo: null,
  messagesById: new Map(),
  inboxItems: [],
};

const INBOX_READ_KEY = 'ai-agent-inbox-read';

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  loadModels();
  loadChannels();
  loadSessions();
  loadPersonas();
  updateInboxBadge();
  els.messageInput.focus();
});

function cacheElements() {
  els.searchInput = document.getElementById('search-input');
  els.channelsList = document.getElementById('channels-list');
  els.dmsList = document.getElementById('dms-list');
  els.channelMembers = document.getElementById('channel-members');
  els.inboxBadge = document.getElementById('inbox-badge');
  els.openInbox = document.getElementById('open-inbox');
  els.inboxMarkRead = document.getElementById('inbox-mark-read');
  els.composerWrap = document.querySelector('.composer-wrap');
  els.channelTitle = document.getElementById('channel-title');
  els.memberCount = document.getElementById('member-count');
  els.chatScroll = document.getElementById('chat-scroll');
  els.messages = document.getElementById('messages');
  els.quickActions = document.getElementById('quick-actions');
  els.messageInput = document.getElementById('message-input');
  els.sendBtn = document.getElementById('send-btn');
  els.attachBtn = document.getElementById('attach-btn');
  els.imageUpload = document.getElementById('image-upload');
  els.attachmentPreview = document.getElementById('attachment-preview');
  els.modelSelector = document.getElementById('model-selector');
  els.modelDropdown = document.getElementById('model-dropdown');
  els.currentModelName = document.getElementById('current-model-name');
  els.createChannelModal = document.getElementById('create-channel-modal');
  els.channelAgentsList = document.getElementById('channel-agents-list');
  els.saveChannelBtn = document.getElementById('save-channel-btn');
  els.cancelChannelBtn = document.getElementById('cancel-channel-btn');
  els.closeChannelModalX = document.getElementById('close-channel-modal-x');
  els.createAgentModal = document.getElementById('create-agent-modal');
  els.toolsList = document.getElementById('tools-list');
  els.browseChannelsBtn = document.getElementById('browse-channels');
  els.createChannelBtn = document.getElementById('create-channel');
  els.createAgentBtn = document.getElementById('create-agent');
  els.createChannelSidebar = document.getElementById('create-channel-sidebar');
  els.saveAgentBtn = document.getElementById('save-agent-btn');
  els.cancelAgentBtn = document.getElementById('cancel-agent-btn');
  els.closeModalX = document.getElementById('close-modal-x');
  els.selectAgentModal = document.getElementById('select-agent-modal');
  els.selectAgentList = document.getElementById('select-agent-list');
  els.selectAgentSearch = document.getElementById('select-agent-search');
  els.cancelSelectAgentBtn = document.getElementById('cancel-select-agent-btn');
  els.closeSelectAgentX = document.getElementById('close-select-agent-x');
  els.createAgentFromDmBtn = document.getElementById('create-agent-from-dm-btn');
  els.sidebarNewDm = document.getElementById('sidebar-new-dm');
  els.composerPlaceholder = document.getElementById('composer-placeholder-label');
  els.settingsModal = document.getElementById('settings-modal');
  els.settingsModalTitle = document.getElementById('settings-modal-title');
  els.saveSettingsBtn = document.getElementById('save-settings-btn');
  els.cancelSettingsBtn = document.getElementById('cancel-settings-btn');
  els.closeSettingsX = document.getElementById('close-settings-x');
  els.openGlobalSettings = document.getElementById('open-global-settings');
  els.openAgentSettings = document.getElementById('open-agent-settings');
  els.cfgProvider = document.getElementById('cfg-provider');
  els.cfgModel = document.getElementById('cfg-model');
  els.cfgBaseUrl = document.getElementById('cfg-base-url');
  els.cfgGrokCliStatus = document.getElementById('grok-cli-status');
  els.cfgGrokCliHint = document.getElementById('cfg-grok-cli-hint');
  els.cfgGroupCompatibleUrl = document.getElementById('cfg-group-compatible-url');
  els.cfgOpenaiKey = document.getElementById('cfg-openai-key');
  els.cfgGeminiKey = document.getElementById('cfg-gemini-key');
  els.cfgCompatibleKey = document.getElementById('cfg-compatible-key');
  els.cfgAgentSelect = document.getElementById('cfg-agent-select');
  els.cfgAgentName = document.getElementById('cfg-agent-name');
  els.cfgAgentModel = document.getElementById('cfg-agent-model');
  els.cfgAgentSafeMode = document.getElementById('cfg-agent-safe-mode');
  els.cfgAgentSystemPrompt = document.getElementById('cfg-agent-system-prompt');
  els.cfgAgentCustomPrompt = document.getElementById('cfg-agent-custom-prompt');
  els.cfgAgentTools = document.getElementById('cfg-agent-tools');
  els.replyPreview = document.getElementById('reply-preview');
  els.replyPreviewAuthor = document.getElementById('reply-preview-author');
  els.replyPreviewSnippet = document.getElementById('reply-preview-snippet');
  els.cancelReplyBtn = document.getElementById('cancel-reply');
}

function bindEvents() {
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  els.messageInput.addEventListener('input', () => {
    autoResizeInput();
    updateSendBtn();
  });

  els.sendBtn.addEventListener('click', sendMessage);
  els.attachBtn.addEventListener('click', () => els.imageUpload.click());
  els.browseChannelsBtn.addEventListener('click', () => els.channelsList.scrollIntoView({ behavior: 'smooth' }));
  els.createChannelBtn.addEventListener('click', openCreateChannelModal);
  els.createChannelSidebar?.addEventListener('click', openCreateChannelModal);
  els.saveChannelBtn?.addEventListener('click', saveChannel);
  els.cancelChannelBtn?.addEventListener('click', closeCreateChannelModal);
  els.closeChannelModalX?.addEventListener('click', closeCreateChannelModal);
  els.sidebarNewDm?.addEventListener('click', openSelectAgentModal);
  els.createAgentFromDmBtn?.addEventListener('click', () => {
    closeSelectAgentModal();
    openCreateAgentModal();
  });
  els.cancelSelectAgentBtn?.addEventListener('click', closeSelectAgentModal);
  els.closeSelectAgentX?.addEventListener('click', closeSelectAgentModal);
  els.selectAgentSearch?.addEventListener('input', () => renderAgentPickerList(els.selectAgentSearch.value));
  els.createAgentBtn.addEventListener('click', openCreateAgentModal);

  els.cancelReplyBtn?.addEventListener('click', clearReply);

  els.saveAgentBtn.addEventListener('click', saveAgent);
  els.cancelAgentBtn.addEventListener('click', closeCreateAgentModal);
  els.closeModalX.addEventListener('click', closeCreateAgentModal);

  els.openGlobalSettings?.addEventListener('click', () => openSettingsModal('global'));
  els.openInbox?.addEventListener('click', openInbox);
  els.inboxMarkRead?.addEventListener('click', markAllInboxRead);
  els.openAgentSettings?.addEventListener('click', () => openSettingsModal('agent'));
  els.saveSettingsBtn?.addEventListener('click', saveSettings);
  els.cancelSettingsBtn?.addEventListener('click', closeSettingsModal);
  els.closeSettingsX?.addEventListener('click', closeSettingsModal);
  els.cfgAgentSelect?.addEventListener('change', () => loadAgentSettingsForm(els.cfgAgentSelect.value));
  els.cfgProvider?.addEventListener('change', () => updateProviderSettingsVisibility());

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab));
  });

  // Close modals when clicking backdrop
  [els.createChannelModal, els.createAgentModal, els.settingsModal, els.selectAgentModal].forEach((modal) => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('show');
      }
    });
  });

  els.modelSelector.addEventListener('click', (e) => {
    e.stopPropagation();
    els.modelDropdown.classList.toggle('show');
  });

  document.addEventListener('click', () => els.modelDropdown.classList.remove('show'));

  els.searchInput.addEventListener('input', filterSidebar);

  els.imageUpload.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.pendingImages.push(ev.target.result);
        renderPreviews();
        updateSendBtn();
      };
      reader.readAsDataURL(file);
    });
    els.imageUpload.value = '';
  });
}

function autoResizeInput() {
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 160)}px`;
}

function avatarFor(name, index = 0) {
  const [color, emoji] = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return { color, emoji, label: name?.[0]?.toUpperCase() || 'A' };
}

function filterSidebar() {
  const q = els.searchInput.value.trim().toLowerCase();
  document.querySelectorAll('.list-item[data-name]').forEach((item) => {
    const name = item.dataset.name.toLowerCase();
    item.classList.toggle('hidden', q && !name.includes(q));
  });
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    state.availableModels = data.models || data;
    state.defaultModelId = data.defaultModel || state.availableModels[0]?.id;
    els.modelDropdown.innerHTML = '';

    state.availableModels.forEach((model) => {
      const div = document.createElement('div');
      div.className = 'model-option';
      div.textContent = model.name;
      div.onclick = (e) => {
        e.stopPropagation();
        state.userPickedModel = true;
        selectModel(model);
        els.modelDropdown.classList.remove('show');
      };
      els.modelDropdown.appendChild(div);
    });

    const preferred =
      state.availableModels.find((m) => m.id === state.defaultModelId) ||
      state.availableModels[0];
    if (preferred) selectModel(preferred);
  } catch (e) {
    console.error('Failed to load models', e);
    els.currentModelName.textContent = 'Model unavailable';
  }
}

function selectModel(model) {
  state.currentModel = model;
  els.currentModelName.textContent = model.name;
  document.querySelectorAll('.model-option').forEach((el) => {
    el.classList.toggle('active', el.textContent === model.name);
  });
}

async function loadChannels() {
  try {
    const res = await fetch('/api/channels');
    state.channels = await res.json();
    renderSidebar();

    if (!state.currentChannelId && state.channels.length > 0) {
      const welcome = state.channels.find((c) => c.id === 'welcome') || state.channels[0];
      await selectChannel(welcome.id);
    }
  } catch (e) {
    console.error('Failed to load channels', e);
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    state.sessions = await res.json();
    renderSidebar();
  } catch (e) {
    console.error('Failed to load sessions', e);
  }
}

async function loadPersonas() {
  try {
    const res = await fetch('/api/personas');
    state.personas = await res.json();
    renderSidebar();
  } catch (e) {
    console.error('Failed to load personas', e);
  }
}

function renderSidebar() {
  els.channelsList.innerHTML = '';
  els.dmsList.innerHTML = '';

  state.channels.forEach((channel) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.dataset.id = channel.id;
    item.dataset.name = channel.name;
    item.dataset.type = 'channel';
    if (state.viewMode === 'channel' && channel.id === state.currentChannelId) {
      item.classList.add('active');
    }
    if (state.viewMode === 'inbox') {
      item.classList.remove('active');
    }
    item.innerHTML = `<span class="prefix">#</span><span>${escapeHtml(channel.name)}</span>`;
    item.onclick = () => selectChannel(channel.id);
    els.channelsList.appendChild(item);
  });

  state.sessions.forEach((session, index) => {
    const av = avatarFor(session.name, index);
    const dmItem = document.createElement('div');
    dmItem.className = 'list-item';
    dmItem.dataset.id = session.id;
    dmItem.dataset.name = session.name || session.id;
    dmItem.dataset.type = 'dm';
    if (state.viewMode === 'dm' && session.id === state.currentSessionId) {
      dmItem.classList.add('active');
    }
    if (state.viewMode === 'inbox') {
      dmItem.classList.remove('active');
    }
    dmItem.innerHTML = `<span class="dm-avatar" style="background:${av.color}">${av.emoji}</span><span>${escapeHtml(session.name || session.id)}</span>`;
    dmItem.onclick = () => selectSession(session.id, session.model, session.name || session.id);
    els.dmsList.appendChild(dmItem);
  });

  const unread = getUnreadInboxCount();
  els.inboxBadge.textContent = String(unread);
  els.inboxBadge.classList.toggle('hidden', unread === 0);
  els.openInbox?.classList.toggle('active', state.viewMode === 'inbox');
}

function getInboxReadSet() {
  try {
    const raw = localStorage.getItem(INBOX_READ_KEY);
    return new Set(JSON.parse(raw || '[]'));
  } catch {
    return new Set();
  }
}

function saveInboxReadSet(set) {
  localStorage.setItem(INBOX_READ_KEY, JSON.stringify([...set]));
}

function getUnreadInboxCount() {
  const read = getInboxReadSet();
  return state.inboxItems.filter((item) => item.isFromAgent && !read.has(item.id)).length;
}

function markInboxItemRead(itemId) {
  const read = getInboxReadSet();
  read.add(itemId);
  saveInboxReadSet(read);
  updateInboxBadge();
}

function markAllInboxRead() {
  const read = getInboxReadSet();
  state.inboxItems.forEach((item) => read.add(item.id));
  saveInboxReadSet(read);
  updateInboxBadge();
  renderInbox();
}

async function updateInboxBadge() {
  try {
    const res = await fetch('/api/inbox');
    state.inboxItems = await res.json();
    const count = getUnreadInboxCount();
    els.inboxBadge.textContent = String(count);
    els.inboxBadge.classList.toggle('hidden', count === 0);
  } catch (e) {
    console.error('Failed to load inbox', e);
  }
}

async function openInbox() {
  state.viewMode = 'inbox';
  state.currentChannelId = null;
  state.currentSessionId = null;
  state.currentChannel = null;
  clearReply();

  els.channelTitle.textContent = 'Inbox';
  els.memberCount.textContent = '';
  els.channelMembers.classList.add('hidden');
  els.inboxMarkRead?.classList.remove('hidden');
  els.composerWrap?.classList.add('hidden');
  els.messageInput.placeholder = 'Select a conversation from Inbox';
  els.quickActions.classList.add('hidden');

  renderSidebar();

  try {
    const res = await fetch('/api/inbox');
    state.inboxItems = await res.json();
    renderInbox();
    updateInboxBadge();
  } catch (e) {
    console.error('Failed to open inbox', e);
    els.messages.innerHTML = '<div class="inbox-empty">Could not load inbox.</div>';
  }
}

function renderInbox() {
  const read = getInboxReadSet();
  els.messages.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'inbox-header';
  header.innerHTML = `<h2>Activity</h2><p>Recent messages and background task updates across your workspace.</p>`;
  els.messages.appendChild(header);

  if (!state.inboxItems.length) {
    const empty = document.createElement('div');
    empty.className = 'inbox-empty';
    empty.textContent = 'No activity yet. Start a conversation in a channel or DM.';
    els.messages.appendChild(empty);
    scrollToBottom();
    return;
  }

  const list = document.createElement('div');
  list.className = 'inbox-list';

  state.inboxItems.forEach((item) => {
    const unread = !read.has(item.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `inbox-item${unread ? ' unread' : ''}`;
    btn.dataset.itemId = item.id;

    const icon = item.type === 'channel' ? '#' : item.type === 'dm' ? '💬' : '⏱';
    const typeLabel = item.type === 'background' ? 'Background task' : item.title;
    const time = formatInboxTime(item.timestamp);

    btn.innerHTML = `
      <span class="inbox-item-icon">${icon}</span>
      <span class="inbox-item-body">
        <span class="inbox-item-top">
          <span class="inbox-item-title">${escapeHtml(typeLabel)}</span>
          <span class="inbox-item-time">${escapeHtml(time)}</span>
        </span>
        <span class="inbox-item-meta">${escapeHtml(item.author)}${item.taskStatus ? ` · ${escapeHtml(item.taskStatus)}` : ''}</span>
        <span class="inbox-item-preview">${escapeHtml(item.preview || '(no content)')}</span>
      </span>
      ${unread ? '<span class="inbox-unread-dot"></span>' : ''}
    `;

    btn.addEventListener('click', () => handleInboxItemClick(item));
    list.appendChild(btn);
  });

  els.messages.appendChild(list);
  scrollToBottom();
}

function formatInboxTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}

async function handleInboxItemClick(item) {
  markInboxItemRead(item.id);

  if (item.type === 'channel') {
    await selectChannel(item.sourceId);
  } else if (item.type === 'dm') {
    await selectSession(item.sourceId, null, item.sourceName);
  } else if (item.type === 'background') {
    await selectSession(item.sourceId, null, item.sourceName);
  }

  updateInboxBadge();
}

function showConversationChrome() {
  els.inboxMarkRead?.classList.add('hidden');
  els.composerWrap?.classList.remove('hidden');
}

function renderChannelMembers(channel) {
  if (!channel?.agents?.length) {
    els.channelMembers.classList.add('hidden');
    els.channelMembers.innerHTML = '';
    els.memberCount.textContent = '0';
    return;
  }

  els.channelMembers.classList.remove('hidden');
  els.memberCount.textContent = String(channel.agents.length);
  els.channelMembers.innerHTML = channel.agents
    .map(
      (a) =>
        `<span class="member-pill"><span class="dot"></span>${escapeHtml(a.name || a.id)} <span style="opacity:0.6">(@${escapeHtml(a.id)})</span></span>`
    )
    .join('');
}

async function selectChannel(channelId) {
  state.viewMode = 'channel';
  state.currentChannelId = channelId;
  state.currentSessionId = null;
  clearReply();
  showConversationChrome();

  const res = await fetch(`/api/channels/${channelId}`);
  const channel = await res.json();
  state.currentChannel = channel;

  els.channelTitle.textContent = channel.name;
  els.messageInput.placeholder = `Message #${channel.name} — use @pm @lead to assign tasks`;
  renderChannelMembers(channel);
  renderSidebar();

  els.messages.innerHTML = '';
  state.messagesById.clear();
  els.quickActions.classList.remove('hidden');

  const divider = document.createElement('div');
  divider.className = 'date-divider';
  divider.innerHTML = '<span>Today</span>';
  els.messages.appendChild(divider);

  const hint = document.createElement('div');
  hint.className = 'mention-hint';
  hint.textContent = `Agents in this channel share memory. Mention someone with @id (e.g. @pm @lead) or message the channel lead.`;
  els.messages.appendChild(hint);

  await loadChannelMessages(channelId);
}

async function loadChannelMessages(channelId) {
  try {
    const res = await fetch(`/api/channels/${channelId}/messages`);
    const messages = await res.json();

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        appendMessage('user', msg.content || '', [], 'You', { id: msg.id, replyTo: msg.replyTo, timestamp: msg.timestamp });
      } else if (msg.role === 'assistant') {
        appendMessage('assistant', msg.content || '', [], msg.author || msg.agentId || 'Agent', { id: msg.id, timestamp: msg.timestamp });
      }
    });

    scrollToBottom();
  } catch (e) {
    console.error('Failed to load channel messages', e);
  }
}

async function openCreateChannelModal() {
  els.createChannelModal.classList.add('show');
  els.channelAgentsList.innerHTML = '';

  await loadSessions();

  state.sessions.forEach((session) => {
    const div = document.createElement('div');
    div.className = 'tool-item';
    div.innerHTML = `<input type="checkbox" id="ch-agent-${session.id}" value="${session.id}" checked><label for="ch-agent-${session.id}">${escapeHtml(session.name || session.id)} (${session.id})</label>`;
    els.channelAgentsList.appendChild(div);
  });
}

function closeCreateChannelModal() {
  els.createChannelModal.classList.remove('show');
}

async function saveChannel() {
  const name = document.getElementById('channel-name').value.trim();
  const description = document.getElementById('channel-desc').value.trim();
  const agentIds = [...els.channelAgentsList.querySelectorAll('input:checked')].map((cb) => cb.value);

  if (!name) {
    alert('Channel name is required');
    return;
  }

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, agentIds }),
    });

    if (res.ok) {
      const channel = await res.json();
      closeCreateChannelModal();
      document.getElementById('channel-name').value = '';
      document.getElementById('channel-desc').value = '';
      await loadChannels();
      await selectChannel(channel.id);
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to create channel');
    }
  } catch (e) {
    console.error(e);
    alert('Failed to create channel');
  }
}

async function selectSession(id, modelId = null, name = 'Agent') {
  state.viewMode = 'dm';
  state.currentSessionId = id;
  state.currentChannelId = null;
  state.currentSessionName = name;
  state.currentChannel = null;
  clearReply();
  showConversationChrome();

  els.channelTitle.textContent = name;
  els.messageInput.placeholder = `Message ${name}`;
  els.channelMembers.classList.add('hidden');
  els.memberCount.textContent = '1';
  renderSidebar();

  if (modelId) {
    const model = state.availableModels.find((m) => m.id === modelId);
    if (model) {
      state.userPickedModel = model.id !== state.defaultModelId;
      selectModel(model);
    }
  } else {
    const configModel = state.availableModels.find((m) => m.id === state.defaultModelId);
    if (configModel) selectModel(configModel);
  }

  els.messages.innerHTML = '';
  state.messagesById.clear();
  els.quickActions.classList.remove('hidden');

  const divider = document.createElement('div');
  divider.className = 'date-divider';
  divider.innerHTML = '<span>Today</span>';
  els.messages.appendChild(divider);

  await loadChatHistory(id);
}

async function loadChatHistory(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    const history = await res.json();

    history.forEach((msg) => {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const author = msg.role === 'user' ? 'You' : state.currentSessionName || 'Agent';
        if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((c) => c.type === 'text');
          const imageParts = msg.content.filter((c) => c.type === 'image_url');
          appendMessage(msg.role, textPart?.text || '', imageParts.map((c) => c.image_url.url), author, {
            id: msg.id,
            replyTo: msg.replyTo,
          });
        } else {
          appendMessage(msg.role, msg.content || '', [], author, { id: msg.id, replyTo: msg.replyTo });
        }
      }
    });

    scrollToBottom();
  } catch (e) {
    console.error('Failed to load chat history', e);
  }
}

async function createNewSession(personaId = 'default', displayName = null) {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaId, name: displayName }),
    });
    const newSession = await res.json();
    await loadSessions();
    await selectSession(newSession.id, null, newSession.name || newSession.id);
    return newSession;
  } catch (e) {
    console.error('Failed to create session', e);
    return null;
  }
}

async function openSelectAgentModal() {
  await loadPersonas();
  await loadSessions();
  els.selectAgentSearch.value = '';
  renderAgentPickerList('');
  els.selectAgentModal.classList.add('show');
  els.selectAgentSearch.focus();
}

function closeSelectAgentModal() {
  els.selectAgentModal.classList.remove('show');
}

function renderAgentPickerList(query = '') {
  const q = query.trim().toLowerCase();
  els.selectAgentList.innerHTML = '';

  const personaById = new Map(state.personas.map((p) => [p.id, p]));
  const sessions = state.sessions.filter((session) => {
    if (!q) return true;
    const persona = personaById.get(session.persona);
    const hay = `${session.name || ''} ${session.id} ${session.persona || ''} ${persona?.name || ''} ${persona?.description || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (sessions.length) {
    const heading = document.createElement('div');
    heading.className = 'agent-picker-heading';
    heading.textContent = 'Active agents';
    els.selectAgentList.appendChild(heading);

    sessions.forEach((session, index) => {
      els.selectAgentList.appendChild(buildAgentPickerItem({
        id: session.id,
        title: session.name || session.id,
        subtitle: personaById.get(session.persona)?.name || session.persona || 'Agent',
        index,
        onSelect: async () => {
          closeSelectAgentModal();
          await selectSession(session.id, session.model, session.name || session.id);
        },
      }));
    });
  }

  const personaIdsWithSession = new Set(state.sessions.map((s) => s.persona));
  const personas = state.personas.filter((persona) => {
    if (!q) return !personaIdsWithSession.has(persona.id);
    const hay = `${persona.id} ${persona.name || ''} ${persona.description || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (personas.length) {
    const heading = document.createElement('div');
    heading.className = 'agent-picker-heading';
    heading.textContent = sessions.length ? 'Start with a persona' : 'Available personas';
    els.selectAgentList.appendChild(heading);

    personas.forEach((persona, index) => {
      els.selectAgentList.appendChild(buildAgentPickerItem({
        id: persona.id,
        title: persona.name || persona.id,
        subtitle: persona.description || persona.id,
        index: index + sessions.length,
        onSelect: async () => {
          closeSelectAgentModal();
          const existing = state.sessions.find((s) => s.id === persona.id)
            || state.sessions.find((s) => s.persona === persona.id);
          if (existing) {
            await selectSession(existing.id, existing.model, existing.name || existing.id);
          } else {
            await createNewSession(persona.id, persona.id);
          }
        },
      }));
    });
  }

  if (!sessions.length && !personas.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-picker-empty';
    empty.textContent = q ? 'No agents match your search.' : 'No agents available yet.';
    els.selectAgentList.appendChild(empty);
  }
}

function buildAgentPickerItem({ id, title, subtitle, index, onSelect }) {
  const av = avatarFor(title, index);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'agent-picker-item';
  btn.innerHTML = `
    <span class="agent-picker-avatar" style="background:${av.color}">${av.emoji}</span>
    <span class="agent-picker-info">
      <span class="agent-picker-title">${escapeHtml(title)}</span>
      <span class="agent-picker-subtitle">${escapeHtml(subtitle)}</span>
    </span>
    <span class="agent-picker-id">@${escapeHtml(id)}</span>
  `;
  btn.addEventListener('click', onSelect);
  return btn;
}

async function openCreateAgentModal() {
  els.createAgentModal.classList.add('show');
  if (els.toolsList.children.length === 0) {
    try {
      const res = await fetch('/api/tools');
      const tools = await res.json();
      tools.forEach((tool) => {
        const div = document.createElement('div');
        div.className = 'tool-item';
        div.innerHTML = `<input type="checkbox" id="tool-${tool.name}" value="${tool.name}" checked><label for="tool-${tool.name}">${tool.name}</label>`;
        els.toolsList.appendChild(div);
      });
    } catch (e) {
      console.error(e);
    }
  }
}

function closeCreateAgentModal() {
  els.createAgentModal.classList.remove('show');
}

async function saveAgent() {
  const name = document.getElementById('agent-name').value;
  const idInput = document.getElementById('agent-id').value;
  const id = idInput || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const description = document.getElementById('agent-desc').value;
  const systemPrompt = document.getElementById('agent-prompt').value;
  const allowedTools = [...els.toolsList.querySelectorAll('input:checked')].map((cb) => cb.value);

  if (!name || !systemPrompt) {
    alert('Name and System Prompt are required');
    return;
  }

  try {
    const res = await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, description, systemPrompt, allowedTools }),
    });

    if (res.ok) {
      closeCreateAgentModal();
      await loadPersonas();

      // Create a runnable agent instance for the new persona
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId: id, name: id }),
      });
      await loadSessions();

      document.getElementById('agent-name').value = '';
      document.getElementById('agent-id').value = '';
      document.getElementById('agent-desc').value = '';
      document.getElementById('agent-prompt').value = '';
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Error creating agent');
    }
  } catch (e) {
    console.error(e);
    alert('Error creating agent');
  }
}

async function sendMessage() {
  const text = els.messageInput.value.trim();
  const images = [...state.pendingImages];
  if (!text && images.length === 0) return;

  if (state.viewMode === 'channel') {
    if (!state.currentChannelId) {
      await openCreateChannelModal();
      return;
    }
    await sendChannelMessage(text, images);
    return;
  }

  if (!state.currentSessionId) {
    openSelectAgentModal();
    return;
  }

  const replyTo = state.replyTo;

  els.messageInput.value = '';
  autoResizeInput();
  state.pendingImages = [];
  renderPreviews();
  updateSendBtn();

  appendMessage('user', text, images, 'You', { replyTo });
  clearReply();
  scrollToBottom();

  const thinkingId = showThinking();
  scrollToBottom();

  try {
    const payload = {
      sessionId: state.currentSessionId,
      message: text,
      images,
    };

    if (replyTo) {
      payload.replyTo = replyTo;
    }

    // Let the agent keep its configured model unless the user explicitly picked another
    if (state.userPickedModel && state.currentModel?.id) {
      payload.model = state.currentModel.id;
    }

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentResponseDiv = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6);
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);
          if (data.type === 'thinking') {
            updateThinking(thinkingId, data.message || 'Analyzing request...');
          } else if (data.type === 'tool_start') {
            removeThinking(thinkingId);
            currentResponseDiv = ensureStreamAssistantRow(
              currentResponseDiv,
              state.currentSessionName || 'Agent'
            );
            addToolCallEvent(currentResponseDiv, data);
          } else if (data.type === 'tool_end') {
            finishToolCallEvent(currentResponseDiv, data);
          } else if (data.type === 'token') {
            removeThinking(thinkingId);
            if (!currentResponseDiv) {
              currentResponseDiv = createMessageRow('assistant');
              const streamMsgId = currentResponseDiv.dataset.msgId;
              state.messagesById.set(streamMsgId, {
                id: streamMsgId,
                role: 'assistant',
                author: state.currentSessionName || 'Agent',
                content: '',
              });
              els.messages.appendChild(currentResponseDiv);
            }
            const contentDiv = currentResponseDiv.querySelector('.msg-text');
            const currentText = contentDiv.getAttribute('data-raw') || '';
            const newText = currentText + data.content;
            contentDiv.setAttribute('data-raw', newText);
            renderMarkdown(contentDiv, newText);
            state.messagesById.set(currentResponseDiv.dataset.msgId, {
              id: currentResponseDiv.dataset.msgId,
              role: 'assistant',
              author: state.currentSessionName || 'Agent',
              content: newText,
            });
            scrollToBottom();
          } else if (data.type === 'error') {
            removeThinking(thinkingId);
            appendMessage('assistant', `Error: ${data.error}`);
          } else if (data.type === 'done') {
            removeThinking(thinkingId);
          }
        } catch (e) {
          console.error('Error parsing SSE data', e);
        }
      }
    }

    removeThinking(thinkingId);
    scrollToBottom();
    updateInboxBadge();
  } catch (e) {
    removeThinking(thinkingId);
    appendMessage('assistant', 'Error sending message');
    console.error(e);
    updateInboxBadge();
  }
}

async function sendChannelMessage(text, images) {
  const replyTo = state.replyTo;

  els.messageInput.value = '';
  autoResizeInput();
  state.pendingImages = [];
  renderPreviews();
  updateSendBtn();

  appendMessage('user', text, images, 'You', { replyTo });
  clearReply();
  scrollToBottom();

  const thinkingId = showThinking('Channel');
  scrollToBottom();

  try {
    const payload = { message: text, images };
    if (replyTo) payload.replyTo = replyTo;
    if (state.userPickedModel && state.currentModel?.id) {
      payload.model = state.currentModel.id;
    }

    const response = await fetch(`/api/channels/${state.currentChannelId}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentResponseDiv = null;
    let currentAuthor = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6);
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);

          if (data.type === 'agent_start') {
            removeThinking(thinkingId);
            currentAuthor = data.agent || data.agentId;
            currentResponseDiv = createMessageRow('assistant', currentAuthor);
            const streamMsgId = currentResponseDiv.dataset.msgId;
            state.messagesById.set(streamMsgId, {
              id: streamMsgId,
              role: 'assistant',
              author: currentAuthor,
              content: '',
            });
            els.messages.appendChild(currentResponseDiv);
            scrollToBottom();
          } else if (data.type === 'thinking') {
            if (!currentResponseDiv) {
              updateThinking(thinkingId, data.message || 'Analyzing request...');
            }
          } else if (data.type === 'tool_start') {
            removeThinking(thinkingId);
            currentResponseDiv = ensureStreamAssistantRow(currentResponseDiv, currentAuthor);
            addToolCallEvent(currentResponseDiv, data);
          } else if (data.type === 'tool_end') {
            finishToolCallEvent(currentResponseDiv, data);
          } else if (data.type === 'token') {
            removeThinking(thinkingId);
            if (!currentResponseDiv || currentAuthor !== (data.agent || data.agentId)) {
              currentAuthor = data.agent || data.agentId;
              currentResponseDiv = createMessageRow('assistant', currentAuthor);
              const streamMsgId = currentResponseDiv.dataset.msgId;
              state.messagesById.set(streamMsgId, {
                id: streamMsgId,
                role: 'assistant',
                author: currentAuthor,
                content: '',
              });
              els.messages.appendChild(currentResponseDiv);
            }
            const contentDiv = currentResponseDiv.querySelector('.msg-text');
            const currentText = contentDiv.getAttribute('data-raw') || '';
            const newText = currentText + data.content;
            contentDiv.setAttribute('data-raw', newText);
            renderMarkdown(contentDiv, newText);
            state.messagesById.set(currentResponseDiv.dataset.msgId, {
              id: currentResponseDiv.dataset.msgId,
              role: 'assistant',
              author: currentAuthor,
              content: newText,
            });
            scrollToBottom();
          } else if (data.type === 'error') {
            removeThinking(thinkingId);
            appendMessage('assistant', `Error: ${data.error}`, [], data.agent || 'Agent');
          } else if (data.type === 'done') {
            removeThinking(thinkingId);
          }
        } catch (e) {
          console.error('Error parsing SSE data', e);
        }
      }
    }

    removeThinking(thinkingId);
    scrollToBottom();
    updateInboxBadge();
  } catch (e) {
    removeThinking(thinkingId);
    appendMessage('assistant', 'Error sending message', [], 'System');
    console.error(e);
    updateInboxBadge();
  }
}

function generateMsgId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getMessagePlainText(content) {
  return typeof content === 'string' ? content : '';
}

function startReply(messageId) {
  const msg = state.messagesById.get(messageId);
  if (!msg) return;
  state.replyTo = {
    id: messageId,
    author: msg.author,
    content: msg.content,
    role: msg.role,
  };
  updateReplyPreview();
  els.messageInput.focus();
}

function updateReplyPreview() {
  if (!state.replyTo) {
    els.replyPreview?.classList.add('hidden');
    return;
  }
  els.replyPreview?.classList.remove('hidden');
  if (els.replyPreviewAuthor) {
    els.replyPreviewAuthor.textContent = state.replyTo.author || 'Message';
  }
  if (els.replyPreviewSnippet) {
    renderMarkdownPreview(els.replyPreviewSnippet, state.replyTo.content || '');
  }
}

function clearReply() {
  state.replyTo = null;
  updateReplyPreview();
}

function createMessageRow(role, authorName = null, options = {}) {
  const isUser = role === 'user';
  const author = authorName || (isUser ? 'You' : state.currentSessionName || 'Agent');
  const av = avatarFor(author, isUser ? 5 : 1);
  const msgId = options.id || generateMsgId();

  const row = document.createElement('div');
  row.className = 'message-row';
  row.dataset.msgId = msgId;
  row.innerHTML = `
    <div class="msg-avatar" style="background:${av.color}">${isUser ? 'f' : av.emoji}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-author">${escapeHtml(author)}</span>
        <span class="msg-time">${formatTime(options.timestamp ? new Date(options.timestamp) : new Date())}</span>
        ${!isUser ? '<span class="msg-badge">managed by you</span>' : ''}
        <div class="msg-actions">
          <button type="button" class="msg-reply-btn" title="Reply">Reply</button>
        </div>
      </div>
      <div class="msg-content"></div>
      <div class="msg-text markdown-body" data-raw=""></div>
    </div>
  `;

  row.querySelector('.msg-reply-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    startReply(msgId);
  });

  const contentWrap = row.querySelector('.msg-content');
  if (options.replyTo) {
    const quote = document.createElement('div');
    quote.className = 'msg-reply-quote';
    quote.innerHTML = `
      <span class="msg-reply-quote-author">${escapeHtml(options.replyTo.author || 'Message')}</span>
      <div class="msg-reply-quote-text markdown-preview markdown-body"></div>
    `;
    const quoteText = quote.querySelector('.msg-reply-quote-text');
    renderMarkdownPreview(quoteText, options.replyTo.content || '');
    quote.addEventListener('click', () => {
      const target = document.querySelector(`.message-row[data-msg-id="${options.replyTo.id}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    contentWrap.appendChild(quote);
  }

  return row;
}

function appendMessage(role, content, images = [], authorName = null, options = {}) {
  if (!content && (!images || images.length === 0)) return null;

  const plainContent = getMessagePlainText(content);
  const msgId = options.id || generateMsgId();
  const author = authorName || (role === 'user' ? 'You' : state.currentSessionName || 'Agent');

  const row = createMessageRow(role, author, { ...options, id: msgId });
  const contentDiv = row.querySelector('.msg-text');

  state.messagesById.set(msgId, {
    id: msgId,
    role,
    author,
    content: plainContent,
    timestamp: options.timestamp,
  });

  if (images?.length) {
    images.forEach((img) => {
      const imgEl = document.createElement('img');
      imgEl.src = img;
      imgEl.className = 'message-image';
      contentDiv.appendChild(imgEl);
    });
  }

  if (content) {
    contentDiv.setAttribute('data-raw', plainContent);
    renderMarkdown(contentDiv, plainContent);
  }

  els.messages.appendChild(row);
  return row;
}

function showThinking(label = 'Agent') {
  const id = `thinking-${Date.now()}`;
  const row = document.createElement('div');
  row.className = 'typing-row';
  row.id = id;
  row.innerHTML = `
    <div class="msg-avatar" style="background:#4a90e2">🤖</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <span class="thinking-text" style="margin-left:8px;color:#9b9b9b;font-size:13px;">${escapeHtml(label)} thinking...</span>
    </div>
  `;
  els.messages.appendChild(row);
  return id;
}

function updateThinking(id, text) {
  const el = document.getElementById(id);
  const span = el?.querySelector('.thinking-text');
  if (span) span.textContent = text;
}

function removeThinking(id) {
  document.getElementById(id)?.remove();
}

function getToolActivityEl(row) {
  let el = row.querySelector('.tool-activity');
  if (!el) {
    el = document.createElement('div');
    el.className = 'tool-activity';
    const msgBody = row.querySelector('.msg-body');
    const msgText = row.querySelector('.msg-text');
    if (msgBody && msgText) {
      msgBody.insertBefore(el, msgText);
    } else if (msgBody) {
      msgBody.appendChild(el);
    }
  }
  return el;
}

function addToolCallEvent(row, data) {
  if (!row) return null;
  const activity = getToolActivityEl(row);
  const callId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const argsStr = data.args ? JSON.stringify(data.args) : '';

  const item = document.createElement('div');
  item.className = 'tool-call-item running';
  item.dataset.toolCallId = callId;
  item.dataset.toolName = data.tool || '';
  item.innerHTML = `
    <span class="tool-call-icon">🛠️</span>
    <span class="tool-call-label">Tool Call:</span>
    <span class="tool-call-name">${escapeHtml(data.tool || 'unknown')}</span>
    <code class="tool-call-args">${escapeHtml(argsStr)}</code>
    <span class="tool-call-status">running</span>
  `;
  activity.appendChild(item);
  scrollToBottom();
  return callId;
}

function finishToolCallEvent(row, data) {
  if (!row) return;
  const activity = row.querySelector('.tool-activity');
  if (!activity) return;

  const running = [...activity.querySelectorAll('.tool-call-item.running')];
  const item = [...running].reverse().find((el) => el.dataset.toolName === data.tool) || running[running.length - 1];
  if (!item) return;

  item.classList.remove('running');
  item.classList.add('done');
  const status = item.querySelector('.tool-call-status');
  if (status) status.textContent = 'done';

  if (data.result) {
    let preview = item.querySelector('.tool-call-result');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'tool-call-result';
      item.appendChild(preview);
    }
    preview.textContent = data.result;
  }
  scrollToBottom();
}

function ensureStreamAssistantRow(currentResponseDiv, authorName) {
  if (currentResponseDiv) return currentResponseDiv;

  const row = createMessageRow('assistant', authorName);
  const streamMsgId = row.dataset.msgId;
  state.messagesById.set(streamMsgId, {
    id: streamMsgId,
    role: 'assistant',
    author: authorName,
    content: '',
  });
  els.messages.appendChild(row);
  return row;
}

function renderPreviews() {
  els.attachmentPreview.innerHTML = '';
  els.attachmentPreview.classList.toggle('show', state.pendingImages.length > 0);

  state.pendingImages.forEach((img, index) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<img src="${img}" alt="attachment"><button class="preview-remove" type="button">×</button>`;
    item.querySelector('.preview-remove').onclick = () => {
      state.pendingImages.splice(index, 1);
      renderPreviews();
      updateSendBtn();
    };
    els.attachmentPreview.appendChild(item);
  });
}

function updateSendBtn() {
  els.sendBtn.classList.toggle('active', !!(els.messageInput.value.trim() || state.pendingImages.length));
}

function scrollToBottom() {
  els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function ensureToolsLoaded() {
  if (state.allTools.length) return state.allTools;
  try {
    const res = await fetch('/api/tools');
    state.allTools = await res.json();
  } catch (e) {
    console.error('Failed to load tools', e);
    state.allTools = [];
  }
  return state.allTools;
}

function switchSettingsTab(tab) {
  state.settingsTab = tab;
  document.querySelectorAll('.settings-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('settings-tab-global')?.classList.toggle('hidden', tab !== 'global');
  document.getElementById('settings-tab-agent')?.classList.toggle('hidden', tab !== 'agent');
}

function resolveSettingsAgentId(preferredId = null) {
  if (preferredId) return preferredId;
  if (state.viewMode === 'dm' && state.currentSessionId) return state.currentSessionId;
  if (state.currentChannel?.agents?.length) return state.currentChannel.agents[0].id;
  if (state.sessions.length) return state.sessions[0].id;
  return null;
}

async function openSettingsModal(tab = 'global', agentId = null) {
  state.settingsTab = tab;
  state.settingsAgentId = resolveSettingsAgentId(agentId);
  switchSettingsTab(tab);

  await loadGlobalSettingsForm();
  await populateAgentSelect();
  if (state.settingsAgentId) {
    await loadAgentSettingsForm(state.settingsAgentId);
  }

  els.settingsModalTitle.textContent = tab === 'global' ? 'AI Settings' : 'Agent Settings';
  els.settingsModal.classList.add('show');
}

function closeSettingsModal() {
  els.settingsModal.classList.remove('show');
}

function updateProviderSettingsVisibility() {
  const provider = els.cfgProvider?.value || 'openai';
  const isGrokCli = provider === 'grok-cli';
  const isCompatible = provider === 'compatible';

  els.cfgGroupCompatibleUrl?.classList.toggle('hidden', !isCompatible);
  els.cfgGrokCliHint?.toggleAttribute('hidden', !isGrokCli);
  els.cfgGrokCliStatus?.classList.toggle('hidden', !isGrokCli);

  if (isGrokCli) {
    refreshGrokCliStatus();
  }
}

function renderGrokCliStatus(status) {
  if (!els.cfgGrokCliStatus) return;

  if (!status) {
    els.cfgGrokCliStatus.textContent = 'Checking Grok CLI session…';
    els.cfgGrokCliStatus.className = 'grok-cli-status';
    return;
  }

  const parts = [];
  if (status.cliAuth?.connected) {
    const email = status.cliAuth.email ? ` (${status.cliAuth.email})` : '';
    const expired = status.cliAuth.expired ? ' — session expired, run grok login' : '';
    parts.push(`CLI session: found${email}${expired}`);
  } else {
    parts.push('CLI session: not found — run grok login');
  }

  if (status.available) {
    parts.push('ready to use');
  } else if (status.reason) {
    parts.push(status.reason);
  }

  els.cfgGrokCliStatus.textContent = parts.join(' · ');
  els.cfgGrokCliStatus.className = `grok-cli-status ${status.available ? 'ok' : 'warn'}`;
}

async function refreshGrokCliStatus() {
  renderGrokCliStatus(null);
  try {
    const res = await fetch('/api/providers/grok-cli/status');
    if (!res.ok) throw new Error('Status check failed');
    renderGrokCliStatus(await res.json());
  } catch (e) {
    renderGrokCliStatus({
      available: false,
      cliAuth: { connected: false },
      reason: e.message,
    });
  }
}

async function loadGlobalSettingsForm() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    els.cfgProvider.value = cfg.provider || 'openai';
    els.cfgModel.value = cfg.model || '';
    els.cfgBaseUrl.value = cfg.compatible_base_url || '';
    els.cfgOpenaiKey.value = '';
    els.cfgOpenaiKey.placeholder = cfg.openai_api_key_set ? `Saved (${cfg.openai_api_key})` : 'Not set';
    els.cfgGeminiKey.value = '';
    els.cfgGeminiKey.placeholder = cfg.gemini_api_key_set ? `Saved (${cfg.gemini_api_key})` : 'Not set';
    els.cfgCompatibleKey.value = '';
    els.cfgCompatibleKey.placeholder = cfg.compatible_api_key_set ? `Saved (${cfg.compatible_api_key})` : 'Not set';
    updateProviderSettingsVisibility();
  } catch (e) {
    console.error('Failed to load config', e);
  }
}

async function populateAgentSelect() {
  await loadSessions();
  els.cfgAgentSelect.innerHTML = '';
  state.sessions.forEach((session) => {
    const opt = document.createElement('option');
    opt.value = session.id;
    opt.textContent = session.name || session.id;
    els.cfgAgentSelect.appendChild(opt);
  });
  if (state.settingsAgentId) {
    els.cfgAgentSelect.value = state.settingsAgentId;
  }
}

async function loadAgentSettingsForm(agentId) {
  if (!agentId) return;
  state.settingsAgentId = agentId;

  try {
    const res = await fetch(`/api/sessions/${agentId}`);
    if (!res.ok) throw new Error('Agent not found');
    const agent = await res.json();

    els.cfgAgentSelect.value = agentId;
    els.cfgAgentName.value = agent.name || '';
    els.cfgAgentModel.value = agent.model || '';
    els.cfgAgentSafeMode.checked = Boolean(agent.safeMode);
    els.cfgAgentSystemPrompt.value = agent.systemPrompt || '';
    els.cfgAgentCustomPrompt.value = agent.customSystemPrompt || '';

    await ensureToolsLoaded();
    els.cfgAgentTools.innerHTML = '';
    const allowed = new Set(agent.allowedTools || []);
    state.allTools.forEach((tool) => {
      const div = document.createElement('div');
      div.className = 'tool-item';
      const checked = allowed.has(tool.name) ? 'checked' : '';
      div.innerHTML = `<input type="checkbox" id="cfg-tool-${tool.name}" value="${tool.name}" ${checked}><label for="cfg-tool-${tool.name}">${tool.name}</label>`;
      els.cfgAgentTools.appendChild(div);
    });
  } catch (e) {
    console.error('Failed to load agent settings', e);
  }
}

async function saveSettings() {
  try {
    if (state.settingsTab === 'global') {
      const payload = {
        provider: els.cfgProvider.value,
        model: els.cfgModel.value.trim(),
        compatible_base_url: els.cfgBaseUrl.value.trim(),
      };
      const openaiKey = els.cfgOpenaiKey.value.trim();
      const geminiKey = els.cfgGeminiKey.value.trim();
      const compatibleKey = els.cfgCompatibleKey.value.trim();
      if (openaiKey) payload.openai_api_key = openaiKey;
      if (geminiKey) payload.gemini_api_key = geminiKey;
      if (compatibleKey) payload.compatible_api_key = compatibleKey;

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save global settings');
      }

      await loadModels();
      closeSettingsModal();
      return;
    }

    const agentId = els.cfgAgentSelect.value || state.settingsAgentId;
    if (!agentId) {
      alert('Select an agent first');
      return;
    }

    const allowedTools = [...els.cfgAgentTools.querySelectorAll('input:checked')].map((cb) => cb.value);
    const modelOverride = els.cfgAgentModel.value.trim();

    const payload = {
      name: els.cfgAgentName.value.trim(),
      safeMode: els.cfgAgentSafeMode.checked,
      customSystemPrompt: els.cfgAgentCustomPrompt.value.trim() || null,
      model: modelOverride || null,
      personaUpdates: {
        systemPrompt: els.cfgAgentSystemPrompt.value.trim(),
        allowedTools,
      },
    };

    const res = await fetch(`/api/sessions/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save agent settings');
    }

    await loadSessions();
    if (state.viewMode === 'dm' && state.currentSessionId === agentId) {
      state.currentSessionName = payload.name || agentId;
      els.channelTitle.textContent = state.currentSessionName;
    }
    closeSettingsModal();
  } catch (e) {
    console.error(e);
    alert(e.message || 'Failed to save settings');
  }
}
