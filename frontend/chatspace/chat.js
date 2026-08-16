let currentConversationId = null;
let currentModel = null;
let selectedKnowledgeFiles = [];
let attachedFiles = [];
let useRag = false;
let agentMode = false;

/* ===================== THINKING TIMER ===================== */

function createThinkingTimer(summaryEl, label = 'Thinking') {
  const startTime = performance.now();

  let timerInterval = null;

  const updateTimer = () => {
    const elapsed = (performance.now() - startTime) / 1000;
    summaryEl.textContent = `${label} · ${elapsed.toFixed(1)}s`;
  };

  updateTimer();

  timerInterval = setInterval(updateTimer, 100);

  return {
    stop() {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      summaryEl.textContent = `${label} · ${elapsed.toFixed(1)}s`;

      return elapsed;
    }
  };
}

/* ===================== NAV & DRAWER ===================== */
const drawer = document.getElementById('drawer');
document.getElementById('burger').addEventListener('click', () => drawer.classList.add('open'));
drawer.querySelector('.drawer-bg').addEventListener('click', () => drawer.classList.remove('open'));
drawer.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => drawer.classList.remove('open'))
);

/* ===================== SIDEBAR TOGGLES WITH BACKDROP ===================== */
const leftSidebar = document.getElementById('leftSidebar');
const rightSidebar = document.getElementById('rightSidebar');
const conversationList = document.getElementById('conversationList');
const newChatBtn = document.getElementById('newChatBtn');
const currentChatTitle = document.getElementById("currentChatTitle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

function isMobile() {
  return window.innerWidth <= 1024;
}

document.getElementById('openLeftSidebar')?.addEventListener('click', (e) => {
  e.stopPropagation();
  leftSidebar.classList.toggle('open');
  if (isMobile() && leftSidebar.classList.contains('open')) sidebarBackdrop?.classList.add('show');
  else checkSidebarBackdrop();
});

document.getElementById('closeLeftSidebar')?.addEventListener('click', () => {
  leftSidebar.classList.remove('open');
  checkSidebarBackdrop();
});

document.getElementById('openRightSidebar')?.addEventListener('click', (e) => {
  e.stopPropagation();
  rightSidebar.classList.toggle('open');
  if (isMobile() && rightSidebar.classList.contains('open')) sidebarBackdrop?.classList.add('show');
  else checkSidebarBackdrop();
});

document.getElementById('closeRightSidebar')?.addEventListener('click', () => {
  rightSidebar.classList.remove('open');
  checkSidebarBackdrop();
});

sidebarBackdrop?.addEventListener('click', () => {
  leftSidebar?.classList.remove('open');
  rightSidebar?.classList.remove('open');
  sidebarBackdrop.classList.remove('show');
});

function checkSidebarBackdrop() {
  if (!leftSidebar?.classList.contains('open') && !rightSidebar?.classList.contains('open')) {
    sidebarBackdrop?.classList.remove('show');
  }
}

window.addEventListener('resize', () => {
  if (!isMobile()) {
    sidebarBackdrop?.classList.remove('show');
  }
});

/* ===================== MODEL SELECTOR LOGIC ===================== */
const modelSelect = document.getElementById('modelSelect');

modelSelect?.addEventListener('change', (e) => {
  currentModel = e.target.value;
});

/* ===================== CUSTOM MODAL SYSTEM ===================== */
let modalResolve = null;

function showCustomModal({ title, message, type, defaultValue, confirmText, isDanger }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customModal');
    document.getElementById('cmTitle').textContent = title;
    document.getElementById('cmMessage').textContent = message;
    
    const input = document.getElementById('cmInput');
    if (type === 'prompt') {
      input.classList.remove('hidden');
      input.value = defaultValue || '';
      setTimeout(() => input.focus(), 50);
    } else {
      input.classList.add('hidden');
    }

    const confirmBtn = document.getElementById('cmBtnConfirm');
    confirmBtn.textContent = confirmText || 'Confirm';
    
    if (isDanger) {
      confirmBtn.className = 'cm-btn cm-btn-danger';
    } else {
      confirmBtn.className = 'cm-btn cm-btn-confirm';
    }

    modal.classList.add('open');
    modalResolve = resolve;
  });
}

function closeCustomModal(value = false) {
  document.getElementById('customModal').classList.remove('open');
  if (modalResolve) {
    modalResolve(value);
    modalResolve = null;
  }
}

document.getElementById('cmBtnCancel')?.addEventListener('click', () => closeCustomModal(false));
document.getElementById('cmBtnConfirm')?.addEventListener('click', () => {
  const input = document.getElementById('cmInput');
  if (!input.classList.contains('hidden')) {
    closeCustomModal(input.value.trim());
  } else {
    closeCustomModal(true);
  }
});
document.getElementById('cmInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('cmBtnConfirm').click();
  }
});

/* ===================== COMPOSER LOGIC ===================== */
const promptInput = document.getElementById('promptInput');
const btnSend = document.getElementById('btnSend');
const attachFileBtn = document.getElementById("attachFileBtn");
const chatFileInput = document.getElementById("chatFileInput");
const attachmentPreview = document.getElementById("attachmentPreview");
const chatStream = document.getElementById('chatStream');
const messageContainer = document.getElementById('messageContainer');
const emptyState = document.getElementById('emptyState');

marked.setOptions({
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
});

promptInput.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = this.scrollHeight + 'px';
  if (this.value === '') this.style.height = 'auto';
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

btnSend.addEventListener('click', handleSend);

/* ===================== SEND / STREAM ===================== */
async function handleSend() {
  const text = promptInput.value.trim();
  if (!text) return; 

  if (!currentConversationId) {
    currentConversationId = await createConversation(text);
    await loadConversations();
  }
  
  document.getElementById("currentChatTitle").textContent = text.slice(0, 50);

  promptInput.value = '';
  promptInput.style.height = 'auto';

  if (!emptyState.classList.contains('hidden')) {
    emptyState.classList.add('hidden');
  }

  const filesForThisMessage = [...attachedFiles];

let uploadedAttachments = [];

if (filesForThisMessage.length > 0) {

  const formData = new FormData();

  formData.append(
    "conversationId",
    currentConversationId
  );

  filesForThisMessage.forEach(file => {
    formData.append("files", file);
  });

  const uploadResponse = await fetch(
    "/api/chat-files/upload",
    {
      method: "POST",
      body: formData,
    }
  );

  const uploadResult =
    await uploadResponse.json();

  if (!uploadResult.success) {

    console.error(uploadResult);

    alert("Attachment upload failed.");

    return;

  }

  uploadedAttachments =
    uploadResult.attachments;

}

attachedFiles = [];

renderAttachments();

chatFileInput.value = "";

  appendUserMessage(text, filesForThisMessage);
  await saveMessage('user', text);
  scrollToBottom();

  if (agentMode) {
    await generateAgentResponse(text, uploadedAttachments);
  } else {
    await generateRealResponse(text, uploadedAttachments);
  }
}

async function generateRealResponse(prompt, uploadedAttachments = []) {
  const streamId = 'stream-' + Date.now();

  const responseHTML = `
    <div class="message ai-msg fade-up">
      <div class="msg-avatar glass">
        <img src="../assets/logo.png" />
      </div>
      <div class="msg-body">
        <div class="msg-content">
          <details class="thinking-box" id="${streamId}-thinking-box" open>
            <summary>Thinking · 0.0s</summary>
            <div id="${streamId}-thinking"></div>
          </details>
          <div id="${streamId}-answer"></div>
          
          <div id="${streamId}-sources-container"></div>
        </div>
      </div>
    </div>
  `;

  messageContainer.insertAdjacentHTML('beforeend', responseHTML);

  const thinkingTarget = document.getElementById(`${streamId}-thinking`);
  const answerTarget = document.getElementById(`${streamId}-answer`);
  const thinkingBox = document.getElementById(`${streamId}-thinking-box`);
  const thinkingSummary = thinkingBox?.querySelector('summary');
  const thinkingTimer = createThinkingTimer(
  thinkingSummary,
  'Thinking'
  );

  let thinkingText = '';
  let answerText = '';
  let fullResponse = '';
  let thinkingClosed = false;

  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // timezone: the device's own IANA zone (e.g. "Asia/Kolkata"), read
      // fresh every request so it stays correct if the user travels or
      // changes their system clock — never hardcode or cache this. Backend
      // uses it to tell the local model the actual current date/time
      // instead of letting it reason from a stale training cutoff (see
      // lib/temporalContext.ts).
      body: JSON.stringify({ model: currentModel, prompt, selectedKnowledgeFiles, uploadedAttachments, conversationId: currentConversationId, useRag, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Stream request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = ''; 

    const processLine = (line) => {
      if (!line.trim()) return;

      let json;
      try {
        json = JSON.parse(line);
      } catch {
        return; 
      }

      if (json.thinking) {
        thinkingText += json.thinking;
        thinkingTarget.textContent = thinkingText;
      }

      if (json.status) {
        // Show the router's status (e.g. "Reading system information...")
        // in the thinking box summary while a tool is running, so the user
        // gets visible feedback before tokens start arriving.
        const summaryEl = thinkingBox?.querySelector('summary');
        if (summaryEl) summaryEl.textContent = json.status;
        return;
      }

      if (json.error) {
        // Server surfaced a structured error mid-stream (Ollama backend
        // error, stall timeout, etc) instead of silently going quiet.
        console.error('[STREAM] server error:', json.error);
        answerTarget.innerHTML = `Error: ${escapeHTML(json.error)}`;
        return;
      }

      if (json.response) {
        answerText += json.response;
        fullResponse += json.response;

        answerTarget.innerHTML = marked.parse(answerText);

        answerTarget.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightElement(block);
        });

        if (thinkingText.length > 0 && !thinkingClosed) {
          thinkingTimer.stop();
          thinkingBox.open = false;
          thinkingClosed = true;
        }
      }

      scrollToBottom();
    };

    const safeProcessLine = (line) => {
      try {
        processLine(line);
      } catch (err) {
        // A throw here previously killed the entire stream (caught by the
        // outer try/catch below) even when most of the response had already
        // arrived fine. Log and keep going instead.
        console.error('[STREAM] processLine threw on line:', line, err);
      }
    };

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        if (buffer.trim()) safeProcessLine(buffer);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); 

      for (const line of lines) safeProcessLine(line);
    }

    // Hide the thinking box entirely if the model produced no thinking tokens
    // (e.g. plain OpenRouter models that don't expose delta.reasoning).
    // Without this, non-thinking models always leave an empty "Thinking..." box.
    if (thinkingBox && !thinkingText.trim()) {
      thinkingBox.style.display = 'none';
    }

    if (!thinkingClosed) {
      thinkingTimer.stop();
      thinkingClosed = true;
    }

    await saveMessage('assistant', fullResponse, thinkingText || undefined);
    
    // Fetch and render sources after streaming
    const sourceResponse = await fetch("/api/chat/sources");
    const sources = await sourceResponse.json();
    
    if (sources && sources.length > 0) {
      renderSourcesPanel(`${streamId}-sources-container`, sources);
    }

  } catch (error) {
    console.error(error);
    answerTarget.innerHTML = 'Streaming failed.';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// generateAgentResponse — "Extended Thinking" mode.
//
// Hits /api/chat/agent-stream instead of /api/chat/stream. That endpoint's
// NDJSON stream is a superset of the normal one: alongside the familiar
// { thinking } / { response } / { status } / { error } lines, it also sends
// { round }, { tool_call }, and { tool_result } as the backend's agent loop
// (services/agentLoop.ts) works through however many tool-call rounds it
// needs before producing a final answer.
//
// Rendered as a single message bubble containing one "round block" per
// round: a collapsible thinking box (same look as the normal thinking box),
// a tool-call chip if the round called a tool, and that tool's result. The
// final round's plain-text output (no tool call) becomes the visible
// answer, same as the normal flow.
// ─────────────────────────────────────────────────────────────────────────
async function generateAgentResponse(prompt, uploadedAttachments = []) {
  const streamId = 'agent-' + Date.now();

  const responseHTML = `
    <div class="message ai-msg fade-up">
      <div class="msg-avatar glass">
        <img src="../assets/logo.png" />
      </div>
      <div class="msg-body">
        <div class="msg-content">
          <div id="${streamId}-rounds"></div>
          <div id="${streamId}-answer"></div>
          <div id="${streamId}-summary-container"></div>
          <div id="${streamId}-sources-container"></div>
        </div>
      </div>
    </div>
  `;

  messageContainer.insertAdjacentHTML('beforeend', responseHTML);

  const roundsTarget = document.getElementById(`${streamId}-rounds`);
  const answerTarget = document.getElementById(`${streamId}-answer`);
  const summaryTarget = document.getElementById(`${streamId}-summary-container`);

  let fullResponse = '';
  let currentRound = 0;
  let currentThinkingText = '';
  let currentThinkingEl = null;
  let currentThinkingBoxEl = null;

  // ── Persistence accumulators ──────────────────────────────────────────
  // Mirrors of what's being rendered live, kept purely so the full session
  // can be saved via message.createWithToolCalls once the stream ends —
  // none of this affects rendering, which still works exactly as before.
  let overallThinking = '';           // concatenated thinking across ALL rounds
  let executionSummaryText = '';      // filled in by summary_done, if it arrives
  const toolCallsForPersist = [];     // one entry per tool_call/tool_result pair
  let pendingToolCall = null;         // the tool_call awaiting its matching tool_result

  // Every round's thinking gets appended to overallThinking as soon as a
  // new round starts (i.e. once we know that round's thinking text is
  // final) — done in startRoundBlock below via a closure over currentRound/
  // currentThinkingText captured at the moment of the PREVIOUS round's end.
  let lastRoundThinkingText = '';
  let lastRoundNumber = 0;

  // Starts a new visible round block (thinking box + placeholder for a
  // tool call/result, if this round ends up calling one). Called both for
  // round 1 and every subsequent round the loop announces.
  const startRoundBlock = (roundNumber) => {
    // Flush the PREVIOUS round's thinking text into the running total
    // before resetting for the new round — currentThinkingText at this
    // point still holds whatever the just-finished round accumulated.
    if (currentThinkingText.trim()) {
      overallThinking += (overallThinking ? '\n\n' : '') +
        `[Round ${currentRound}] ${currentThinkingText}`;
    }
    lastRoundNumber = currentRound;
    lastRoundThinkingText = currentThinkingText;

    currentRound = roundNumber;
    currentThinkingText = '';

    const roundHTML = `
      <details class="thinking-box" id="${streamId}-round-${roundNumber}-box" open>
        <summary>Thinking (round ${roundNumber}) · 0.0s</summary>
        <div id="${streamId}-round-${roundNumber}-thinking"></div>
      </details>
      <div id="${streamId}-round-${roundNumber}-tool"></div>
    `;
    roundsTarget.insertAdjacentHTML('beforeend', roundHTML);

    currentThinkingEl = document.getElementById(`${streamId}-round-${roundNumber}-thinking`);
    currentThinkingBoxEl = document.getElementById(`${streamId}-round-${roundNumber}-box`);
    currentThinkingTimer = createThinkingTimer(currentThinkingBoxEl.querySelector('summary'),'Thinking (round${roundNumber})');
  };

  // Round 1 starts immediately — the backend also sends an explicit
  // { round: 1 } line, but rendering it eagerly avoids a blank first
  // moment before the first NDJSON line arrives.
  startRoundBlock(1);

  try {
    const response = await fetch('/api/chat/agent-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // See the matching comment on the /api/chat/stream call above —
      // same reasoning, same field.
      body: JSON.stringify({ model: currentModel, prompt, selectedKnowledgeFiles, uploadedAttachments, conversationId: currentConversationId, useRag, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Agent stream request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = (line) => {
      if (!line.trim()) return;

      let json;
      try {
        json = JSON.parse(line);
      } catch {
        return;
      }

      if (json.round) {
        // Round 1 is already rendered eagerly above (avoids a blank first
        // moment before any NDJSON line arrives) — only render a NEW block
        // when this is actually a later round.
        if (json.round !== currentRound) {
          startRoundBlock(json.round);
        }
        return;
      }

      if (json.thinking) {
        currentThinkingText += json.thinking;
        if (currentThinkingEl) currentThinkingEl.textContent = currentThinkingText;
        return;
      }

      if (json.tool_call) {
        if (currentThinkingBoxEl && currentThinkingText.length > 0) {
          if (currentThinkingTimer){
            currentThinkingTimer.stop();
            currentThinkingTimer = null;
          }
          currentThinkingBoxEl.open = false;
        }

        // Stash this call for persistence — matched up with its result
        // below when tool_result arrives. If a tool_call somehow arrives
        // without a following tool_result (stream cut off mid-call), it
        // gets flushed as a best-effort "still running" entry at save time
        // (see the save-time fallback near the end of this function).
        pendingToolCall = {
          round: currentRound,
          instruction: null, // not sent as a separate event today; left null
          tool: json.tool_call.tool,
          arguments: json.tool_call.arguments,
          thinking: currentThinkingText,
        };

        const toolTarget = document.getElementById(`${streamId}-round-${currentRound}-tool`);
        if (toolTarget) {
          toolTarget.innerHTML = `
            <div class="tool-call-chip">
              <span class="tool-call-icon">⚙</span>
              <span class="tool-call-label">Calling <code>${escapeHTML(json.tool_call.tool)}</code></span>
              <span class="tool-call-args">${escapeHTML(JSON.stringify(json.tool_call.arguments))}</span>
            </div>
            <div class="tool-result-pending">Running...</div>
          `;
        }
        return;
      }

      if (json.tool_result) {
        // Complete the pending call and move it into the persisted list.
        // Defensive: if pendingToolCall is somehow null (tool_result with
        // no matching prior tool_call — shouldn't happen, but the backend
        // is a separate codebase and streams can be re-ordered by bugs we
        // don't control here), still record what we can rather than
        // silently dropping the result.
        const completed = pendingToolCall ?? { round: currentRound, instruction: null, tool: 'unknown', arguments: {}, thinking: currentThinkingText };
        completed.result = typeof json.tool_result.result === 'string'
          ? json.tool_result.result
          : JSON.stringify(json.tool_result.result ?? null);
        completed.success = !!json.tool_result.success;
        completed.error = json.tool_result.error || undefined;
        toolCallsForPersist.push(completed);
        pendingToolCall = null;

        const toolTarget = document.getElementById(`${streamId}-round-${currentRound}-tool`);
        const pending = toolTarget?.querySelector('.tool-result-pending');
        if (pending) {
          if (json.tool_result.success) {
            pending.outerHTML = `<div class="tool-result-ok">✓ Done</div>`;
          } else {
            pending.outerHTML = `<div class="tool-result-error">✗ ${escapeHTML(json.tool_result.error || 'Tool failed')}</div>`;
          }
        }
        return;
      }

      if (json.status) {
        if (currentThinkingBoxEl) {
          const summaryEl = currentThinkingBoxEl.querySelector('summary');
          if (summaryEl) summaryEl.textContent = json.status;
        }
        return;
      }

      if (json.error) {
        console.error('[AGENT STREAM] server error:', json.error);
        answerTarget.innerHTML += `<div class="tool-result-error">Error: ${escapeHTML(json.error)}</div>`;
        return;
      }

      if (json.summary_chunk) {
        executionSummaryText += json.summary_chunk;

        // Render lazily — first chunk creates the block, subsequent chunks
        // just update its content. Kept visually distinct from the main
        // answer (its own <details>, closed by default like a thinking
        // box) since this is a recap generated AFTER the real answer, not
        // a replacement for it.
        let summaryBox = document.getElementById(`${streamId}-summary-box`);
        if (!summaryBox) {
          summaryTarget.innerHTML = `
            <details class="thinking-box summary-box" id="${streamId}-summary-box" open>
              <summary>Session summary</summary>
              <div id="${streamId}-summary-text"></div>
            </details>
          `;
          summaryBox = document.getElementById(`${streamId}-summary-box`);
        }
        const summaryTextEl = document.getElementById(`${streamId}-summary-text`);
        if (summaryTextEl) {
          summaryTextEl.innerHTML = marked.parse(executionSummaryText);
        }
        scrollToBottom();
        return;
      }

      if (json.summary_done) {
        executionSummaryText = json.summary_done.summary || executionSummaryText;
        return;
      }

      if (json.response) {
        fullResponse += json.response;

        // Once the final round starts writing a plain answer (no tool
        // call), collapse its thinking box, same as the normal flow.
        if (currentThinkingBoxEl && currentThinkingText.length > 0) {
          if (currentThinkingTimer){
            currentThinkingTimer.stop();
            currentThinkingTimer = null;
          }
          currentThinkingBoxEl.open = false;
        }

        answerTarget.innerHTML = marked.parse(fullResponse);
        answerTarget.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightElement(block);
        });
      }

      scrollToBottom();
    };

    const safeProcessLine = (line) => {
      try {
        processLine(line);
      } catch (err) {
        console.error('[AGENT STREAM] processLine threw on line:', line, err);
      }
    };

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        if (buffer.trim()) safeProcessLine(buffer);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) safeProcessLine(line);
    }

    // Flush whatever the LAST round accumulated — startRoundBlock() only
    // flushes the PREVIOUS round's thinking each time a new one starts, so
    // the final round's thinking text never goes through that path (there's
    // no "next round" to trigger it). Do it once here instead.
    if (currentThinkingText.trim()) {
      overallThinking += (overallThinking ? '\n\n' : '') +
        `[Round ${currentRound}] ${currentThinkingText}`;
    }

    // If the stream ended with a tool_call that never got a matching
    // tool_result (connection dropped mid-call, etc.), still persist it
    // rather than silently losing that it happened at all.
    if (pendingToolCall) {
      pendingToolCall.result = undefined;
      pendingToolCall.success = false;
      pendingToolCall.error = 'Stream ended before this tool call completed';
      toolCallsForPersist.push(pendingToolCall);
      pendingToolCall = null;
    }

    await saveExtendedMessage({
      content: fullResponse,
      thinking: overallThinking,
      executionSummary: executionSummaryText,
      toolCalls: toolCallsForPersist,
    });

    const sourceResponse = await fetch("/api/chat/sources");
    const sources = await sourceResponse.json();

    if (sources && sources.length > 0) {
      renderSourcesPanel(`${streamId}-sources-container`, sources);
    }

  } catch (error) {
    console.error(error);
    answerTarget.innerHTML = 'Agent streaming failed.';
  }
}

// FIX: accepts optional files array and renders chips inside the message bubble
function appendUserMessage(text, files = []) {
  let attachmentsHtml = '';

  if (files.length > 0) {
    const chips = files.map(file => `
      <div class="attachment-chip" style="pointer-events:none;">
        <div class="attachment-icon">${getFileIcon(file)}</div>
        <div class="attachment-info">
          <div class="attachment-name">${escapeHTML(file.name)}</div>
          <div class="attachment-size">${formatFileSize(file.size)}</div>
        </div>
      </div>
    `).join('');

    attachmentsHtml = `
      <div class="attachment-preview" style="margin-bottom:10px; pointer-events:none;">
        ${chips}
      </div>
    `;
  }

  const msgHTML = `
    <div class="message user-msg fade-up">
      <div class="msg-content">
        ${attachmentsHtml}
        ${escapeHTML(text)}
      </div>
      <div class="msg-actions">
        <button class="action-btn">Edit</button>
      </div>
    </div>
  `;
  messageContainer.insertAdjacentHTML('beforeend', msgHTML);
}

function appendAIMessage(text, thinking = null, sources = []) {
  const streamId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  let thinkingHtml = '';
  
  if (thinking && thinking.trim() !== '') {
    thinkingHtml = `
      <details class="thinking-box">
        <summary>Thinking...</summary>
        <div>${escapeHTML(thinking)}</div>
      </details>
    `;
  }

  const html = `
    <div class="message ai-msg fade-up">
      <div class="msg-avatar glass">
        <img src="../assets/logo.png" />
      </div>
      <div class="msg-body">
        <div class="msg-content">
          ${thinkingHtml}
          ${marked.parse(text)}
          <div id="${streamId}-sources-container"></div>
        </div>
      </div>
    </div>
  `;
  messageContainer.insertAdjacentHTML('beforeend', html);

  const lastMsg = messageContainer.lastElementChild;
  lastMsg.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

  if (sources && sources.length > 0) {
    renderSourcesPanel(`${streamId}-sources-container`, sources);
  }
}

// Reconstructs an extended-thinking (agent loop) message from history —
// same visual shape as generateAgentResponse() renders live (round blocks
// with thinking + tool call/result, final answer, session summary), but
// built all at once from already-complete data instead of streamed. Called
// from loadConversation() for any message with isExtended === true.
//
// `message` here is a row shaped like conversation.getById's / message.list's
// return: { content, thinking, executionSummary, toolCalls: [...], ... }.
// `message.thinking` is the overall concatenated trace saved by
// saveExtendedMessage() in the form "[Round N] ...\n\n[Round N+1] ...";
// toolCalls carries each round's own thinking/tool/result, which is what's
// actually used to rebuild the per-round blocks below (message.thinking as
// a whole isn't re-split back into per-round pieces — that round-tagged
// text is kept mainly as a readable single-blob fallback/search target).
function appendExtendedAIMessage(message) {
  const streamId = 'hist-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
  const toolCalls = message.toolCalls || [];

  // Group tool calls by round so multiple calls in one round (the router
  // can occasionally resolve more than one, see agentLoop.ts) render under
  // the same round block, same as live streaming would have shown them.
  const byRound = new Map();
  for (const call of toolCalls) {
    const list = byRound.get(call.round) ?? [];
    list.push(call);
    byRound.set(call.round, list);
  }

  const roundsHtml = Array.from(byRound.keys()).sort((a, b) => a - b).map((roundNumber) => {
    const calls = byRound.get(roundNumber);
    const roundThinking = calls.map((c) => c.thinking).filter(Boolean).join('\n\n');

    const thinkingBlock = roundThinking ? `
      <details class="thinking-box">
        <summary>Thinking (round ${roundNumber})</summary>
        <div>${escapeHTML(roundThinking)}</div>
      </details>
    ` : '';

    const toolsBlock = calls.map((call) => `
      <div class="tool-call-chip">
        <span class="tool-call-icon">⚙</span>
        <span class="tool-call-label">Calling <code>${escapeHTML(call.tool)}</code></span>
        <span class="tool-call-args">${escapeHTML(JSON.stringify(call.arguments || {}))}</span>
      </div>
      ${call.success
        ? `<div class="tool-result-ok">✓ Done</div>`
        : `<div class="tool-result-error">✗ ${escapeHTML(call.error || 'Tool failed')}</div>`}
    `).join('');

    return thinkingBlock + toolsBlock;
  }).join('');

  const summaryHtml = message.executionSummary && message.executionSummary.trim() !== '' ? `
    <details class="thinking-box summary-box">
      <summary>Session summary</summary>
      <div>${marked.parse(message.executionSummary)}</div>
    </details>
  ` : '';

  const html = `
    <div class="message ai-msg fade-up">
      <div class="msg-avatar glass">
        <img src="../assets/logo.png" />
      </div>
      <div class="msg-body">
        <div class="msg-content">
          ${roundsHtml}
          ${marked.parse(message.content || '')}
          ${summaryHtml}
          <div id="${streamId}-sources-container"></div>
        </div>
      </div>
    </div>
  `;
  messageContainer.insertAdjacentHTML('beforeend', html);

  const lastMsg = messageContainer.lastElementChild;
  lastMsg.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

  if (message.sources && message.sources.length > 0) {
    renderSourcesPanel(`${streamId}-sources-container`, message.sources);
  }
}

/* ===================== RENDER SOURCES PANEL ===================== */
function renderSourcesPanel(containerId, sources) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const itemsHtml = sources.map(s => `
    <div class="source-item" data-file-id="${s.fileId}">
      <svg class="si-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      <div class="si-info">
        <span class="si-name">${escapeHTML(s.fileName)}</span>
        ${s.chunkId !== undefined ? `<span class="si-chunk">Chunk #${s.chunkId}</span>` : ''}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <details class="msg-sources glass-strong">
      <summary class="sources-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span>Sources Used</span>
      </summary>
      <div class="sources-body">
        ${itemsHtml}
      </div>
    </details>
  `;
}

function scrollToBottom() {
  chatStream.scrollTop = chatStream.scrollHeight;
}

function setActiveConversation(id){
  document
    .querySelectorAll(".conversation-item")
    .forEach(item => {
      item.classList.remove("active");
    });

  const title = document.querySelector(`.conversation-title[data-id="${id}"]`);
  if(title) {
    title.closest(".conversation-item")?.classList.add("active");
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (["png","jpg","jpeg","webp","gif"].includes(ext))
    return "🖼";

  if (["pdf"].includes(ext))
    return "📄";

  if (["doc","docx"].includes(ext))
    return "📝";

  if (["xls","xlsx","csv"].includes(ext))
    return "📊";

  if (["ppt","pptx"].includes(ext))
    return "📈";

  if (["js","ts","py","java","c","cpp","html","css","json","xml","yml","yaml"].includes(ext))
    return "💻";

  return "📎";
}

function renderAttachments() {
  attachmentPreview.innerHTML = "";

  if (attachedFiles.length === 0) {
    attachmentPreview.classList.add("hidden");
    return;
  }

  attachmentPreview.classList.remove("hidden");

  attachedFiles.forEach((file, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    chip.innerHTML = `
      <div class="attachment-icon">${getFileIcon(file)}</div>

      <div class="attachment-info">
        <div class="attachment-name">${escapeHTML(file.name)}</div>
        <div class="attachment-size">${formatFileSize(file.size)}</div>
      </div>

      <button
        class="attachment-remove"
        data-index="${index}">
        ✕
      </button>
    `;

    attachmentPreview.appendChild(chip);
  });
}

function addAttachments(files) {
  const incoming = Array.from(files);
  if (incoming.length === 0) return;

  attachedFiles.push(...incoming);
  renderAttachments();
}

/* ===================== DRAG & DROP ===================== */
promptInput.addEventListener("dragover", (e) => {
  e.preventDefault();
});

promptInput.addEventListener("drop", (e) => {
  e.preventDefault();
  addAttachments(e.dataTransfer.files);
});

/* ===================== PASTE FROM CLIPBOARD ===================== */
promptInput.addEventListener("paste", (e) => {
  const files = [];

  for (const item of e.clipboardData.items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  // FIX: only intercept paste if there are actual files — otherwise let text paste through normally
  if (files.length > 0) {
    e.preventDefault();
    addAttachments(files);
  }
});

/* ===================== FILE INPUT BUTTON ===================== */
attachFileBtn.addEventListener("click", () => {
  chatFileInput.click();
});

chatFileInput.addEventListener("change", (e) => {
  addAttachments(e.target.files);
  // FIX: reset input value so selecting the same file again fires the change event
  chatFileInput.value = "";
});

/* ===================== REMOVE ATTACHMENT CHIP ===================== */
attachmentPreview.addEventListener("click", (e) => {
  const btn = e.target.closest(".attachment-remove");
  if (!btn) return;

  attachedFiles.splice(Number(btn.dataset.index), 1);
  renderAttachments();
});

/* ===================== QUICK ACTION BUTTONS ===================== */
document.querySelectorAll('.qa-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const text = e.target.textContent.replace(/^[^\w\s]+/, '').trim(); 
    promptInput.value = `I'd like to ${text.toLowerCase()} a concept regarding...`;
    promptInput.focus();
  });
});

document.querySelectorAll('.suggestion-grid .card').forEach((card) => {
  card.addEventListener('click', () => {
    const text = card.querySelector('p').textContent;
    promptInput.value = text;
    handleSend();
  });
});

/* ===================== CONVERSATION API ===================== */
async function createConversation(firstPrompt) {
  const response = await fetch('/api/trpc/conversation.create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: {
        title: firstPrompt.slice(0, 50),
        modelId: currentModel,
      },
    }),
  });

  const data = await response.json();
  return data.result.data.json.id;
}

async function saveMessage(role, content, thinking) {
  if (!currentConversationId) return;

  await fetch('/api/trpc/message.create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: {
        conversationId: currentConversationId,
        role,
        content,
        // Forward the accumulated thinking trace so the DB thinking column
        // is populated and the thinking box reappears on conversation reload.
        // Omitted (undefined) for plain non-thinking model responses.
        ...(thinking ? { thinking } : {}),
      },
    }),
  });
}

// Persists a full extended-thinking (agent loop) session in one call via
// message.createWithToolCalls (routers/message.ts) — the message row plus
// every tool call as its own message_tool_calls row, in a single DB
// transaction. Used by generateAgentResponse() instead of the plain
// saveMessage() above, which only ever stored `content` and had no way to
// carry thinking, the post-loop summary, or the tool-call trail at all.
async function saveExtendedMessage({ content, thinking, executionSummary, toolCalls }) {
  if (!currentConversationId) return;

  try {
    await fetch('/api/trpc/message.createWithToolCalls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: {
          conversationId: currentConversationId,
          content,
          thinking: thinking || undefined,
          executionSummary: executionSummary || undefined,
          toolCalls: toolCalls || [],
        },
      }),
    });
  } catch (err) {
    // Persistence failing must never break the already-rendered response —
    // the user has already seen the full answer and tool trail live; a
    // save failure just means history reload won't show it, which is a
    // console-logged degradation, not a user-facing error.
    console.error('[AGENT STREAM] saveExtendedMessage failed:', err);
  }
}

async function loadModels() {
  try {
    const response = await fetch("/api/trpc/model.list");
    const data = await response.json();
    const models = data?.result?.data?.json || [];

    if (!modelSelect) return;

    const openRouterModels = models.filter((m) => m.source === "openrouter");
    const ollamaModels = models.filter((m) => m.source === "ollama");

    let html = '';
    if (openRouterModels.length) {
      html += '<optgroup label="Open Router Models">';
      html += openRouterModels.map(m => `<option value="${m.name}">${escapeHTML(m.displayName)}</option>`).join('');
      html += '</optgroup>';
    }
    if (ollamaModels.length) {
      html += '<optgroup label="Ollama Models">';
      html += ollamaModels.map(m => `<option value="${m.name}">${escapeHTML(m.displayName)}</option>`).join('');
      html += '</optgroup>';
    }
    modelSelect.innerHTML = html;

    if (models.length > 0 && !currentModel) {
      currentModel = models[0].name;
      modelSelect.value = currentModel;
    }
    
    // Trigger change so liquid-select can catch up if needed
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (err) {
    console.error("MODEL LOAD ERROR", err);
    if(modelSelect) modelSelect.innerHTML = `<option disabled selected>Error loading</option>`;
  }
}

async function loadKnowledgeFiles() {
  try {
    const response = await fetch("/api/trpc/file.list");
    const data = await response.json();
    const files = data.result.data.json.files;
    const container = document.getElementById("knowledgeFileList");

    if (!container) return;
    container.innerHTML = "";

    files.forEach(file => {
      const label = document.createElement("label");
      label.className = "k-file-item";
      label.innerHTML = `
        <input type="checkbox" value="${file.id}" />
        <span>${file.name}</span>
      `;

      const checkbox = label.querySelector("input");
      checkbox.addEventListener("change", () => {
        selectedKnowledgeFiles = Array.from(document.querySelectorAll("#knowledgeFileList input:checked")).map(cb => Number(cb.value));
      });

      container.appendChild(label);
    });

  } catch (err) {
    console.error("Knowledge Files Error", err);
  }
}

document.getElementById('ragToggle')?.addEventListener('change', (e) => {
  useRag = e.target.checked;
});

document.getElementById('agentModeToggle')?.addEventListener('change', (e) => {
  agentMode = e.target.checked;
});

async function loadConversations() {
  try {
    const response = await fetch('/api/trpc/conversation.list');
    const data = await response.json();
    const conversations = data.result.data.json;

    conversationList.innerHTML = '';

    conversations.forEach((conversation) => {
      const li = document.createElement('li');
      li.className = 'conversation-item';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'conversation-title';
      titleSpan.textContent = conversation.title;
      titleSpan.dataset.id = conversation.id;
      titleSpan.dataset.title = conversation.title;

      const delBtn = document.createElement('button');
      delBtn.className = 'chat-delete-btn';
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
      delBtn.dataset.id = conversation.id;

      li.appendChild(titleSpan);
      li.appendChild(delBtn);
      conversationList.appendChild(li);
      
      if (conversation.id === currentConversationId) {
        li.classList.add("active");
      }
    });

  } catch (error) {
    console.error('Conversation Load Error', error);
  }
}

conversationList.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.chat-delete-btn');
  if (delBtn) {
    deleteConversation(Number(delBtn.dataset.id), e);
    return;
  }

  const item = e.target.closest('.conversation-item');
  if (item) {
    const titleEl = item.querySelector('.conversation-title');
    if (titleEl) {
      loadConversation(Number(titleEl.dataset.id));
    }
  }
});

conversationList.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.conversation-item');
  if (item) {
    const titleEl = item.querySelector('.conversation-title');
    if (titleEl) {
      renameConversation(Number(titleEl.dataset.id), titleEl.dataset.title);
    }
  }
});

async function loadConversation(id) {
  try {
    const response = await fetch(
      `/api/trpc/conversation.getById?input=${encodeURIComponent(
        JSON.stringify({ json: { id } })
      )}`
    );

    const data = await response.json();
    const conversation = data.result.data.json;
    document.getElementById("currentChatTitle").textContent = conversation.title || "New Chat";

    currentConversationId = conversation.id;
    setActiveConversation(conversation.id);
    messageContainer.innerHTML = '';
    
    currentModel = conversation.modelId;
    if (modelSelect && currentModel) {
      modelSelect.value = currentModel;
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    conversation.messages.forEach((message) => {
      if (message.role === 'user') {
        appendUserMessage(message.content);
      } else if (message.isExtended) {
        appendExtendedAIMessage(message);
      } else {
        appendAIMessage(message.content, message.thinking, message.sources);
      }
    });

    emptyState.classList.add('hidden');
    scrollToBottom();
    
    if(isMobile()) {
      leftSidebar.classList.remove('open');
      checkSidebarBackdrop();
    }
  } catch (error) {
    console.error(error);
  }
}

async function deleteConversation(id, event) {
  event.stopPropagation();
  
  const titleEl = document.querySelector(`.conversation-title[data-id="${id}"]`);
  const chatTitle = titleEl ? titleEl.dataset.title : "this conversation";

  const confirmed = await showCustomModal({
    title: "Delete Conversation",
    message: `Are you sure you want to permanently delete "${chatTitle}"?`,
    type: "confirm",
    confirmText: "Delete",
    isDanger: true
  });

  if (!confirmed) return;

  try {
    await fetch('/api/trpc/conversation.delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { id } }),
    });

    if (currentConversationId === id) {
      currentConversationId = null;
      messageContainer.innerHTML = '';
      emptyState.classList.remove('hidden');
      document.getElementById("currentChatTitle").textContent = "New Chat";
    }

    loadConversations();
  } catch (error) {
    console.error('Delete Error', error);
  }
}


async function renameConversation(id, currentTitle) {
  const newTitle = await showCustomModal({
    title: "Rename Conversation",
    message: "Enter a new name for this conversation:",
    type: "prompt",
    defaultValue: currentTitle,
    confirmText: "Rename"
  });

  if (!newTitle || newTitle === currentTitle) return;

  try {
    await fetch('/api/trpc/conversation.update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { id, title: newTitle } }),
    });
    
    if (currentConversationId === id) {
      document.getElementById("currentChatTitle").textContent = newTitle;
    }
    loadConversations();
    
  } catch (error) {
    console.error('Rename Error', error);
  }
}

const handleNewChat = () => {
  currentConversationId = null;
  messageContainer.innerHTML = '';
  emptyState.classList.remove('hidden');
  document.getElementById("currentChatTitle").textContent = "New Chat";
  
  if(isMobile()) {
    leftSidebar.classList.remove('open');
    checkSidebarBackdrop();
  }
  document.querySelectorAll(".conversation-item").forEach(item => {
    item.classList.remove("active");
  });
};

document.getElementById('newChatBtn')?.addEventListener('click', handleNewChat);
document.getElementById('newChatBtnHeader')?.addEventListener('click', handleNewChat);


(async () => {
  await loadModels();
  await loadConversations();
  await loadKnowledgeFiles();
})();

// Outside click logic for floating sidebars on desktop
document.addEventListener('click', (e) => {
  if (!isMobile()) {
    const isLeftClick = leftSidebar?.contains(e.target) || document.getElementById('openLeftSidebar')?.contains(e.target);
    const isRightClick = rightSidebar?.contains(e.target) || document.getElementById('openRightSidebar')?.contains(e.target);
    
    if (!isLeftClick && leftSidebar?.classList.contains('open')) {
      leftSidebar.classList.remove('open');
    }
    if (!isRightClick && rightSidebar?.classList.contains('open')) {
      rightSidebar.classList.remove('open');
    }
  }
});