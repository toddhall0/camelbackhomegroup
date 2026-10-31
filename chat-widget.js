/* Kathy — AI Chat Widget for Camelback Home Group */
(function(){
  var isTyping = false;

  // Restore chat state from sessionStorage
  var chatOpen = false;
  var messages = [];
  try {
    var saved = JSON.parse(sessionStorage.getItem('kathy_messages'));
    if(saved && Array.isArray(saved)) messages = saved;
    chatOpen = sessionStorage.getItem('kathy_open') === '1';
  } catch(e){}

  // Identifies this conversation in the CRM for the life of the browser tab
  var sessionId = '';
  try { sessionId = sessionStorage.getItem('kathy_session') || ''; } catch(e){}
  if(!sessionId){
    sessionId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    try { sessionStorage.setItem('kathy_session', sessionId); } catch(e){}
  }

  function saveChat(){
    try{
      sessionStorage.setItem('kathy_messages', JSON.stringify(messages));
      sessionStorage.setItem('kathy_open', chatOpen ? '1' : '0');
    }catch(e){}
  }

  // Inject styles
  var style = document.createElement('style');
  style.textContent = `
.kathy-toggle{position:fixed;bottom:24px;right:24px;z-index:9000;width:60px;height:60px;border-radius:50%;background:var(--gold,#cc624c);color:#fff;border:none;cursor:pointer;box-shadow:0 4px 20px rgba(204,98,76,0.4);display:flex;align-items:center;justify-content:center;transition:all 0.3s;font-size:1.5rem}
.kathy-toggle:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(204,98,76,0.5)}
.kathy-toggle svg{width:28px;height:28px}
.kathy-badge{position:absolute;top:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:#1f4e60;border:2px solid #fff;display:none;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700}
.kathy-window{position:fixed;bottom:96px;right:24px;z-index:9001;width:380px;max-height:560px;background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,0.18);display:none;flex-direction:column;overflow:hidden;font-family:Jost,Helvetica,sans-serif}
.kathy-window.open{display:flex}
.kathy-header{background:linear-gradient(135deg,#1f4e60 0%,#2d6b80 100%);padding:18px 20px;display:flex;align-items:center;gap:12px}
.kathy-avatar{width:40px;height:40px;border-radius:50%;background:#cc624c;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:600;color:#fff;flex-shrink:0}
.kathy-header-info{flex:1}
.kathy-header-name{color:#fff;font-size:1rem;font-weight:500}
.kathy-header-status{color:rgba(255,255,255,0.65);font-size:0.78rem}
.kathy-close{background:none;border:none;color:rgba(255,255,255,0.6);font-size:1.4rem;cursor:pointer;padding:4px;line-height:1;transition:color 0.2s}
.kathy-close:hover{color:#fff}
.kathy-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;min-height:280px;max-height:380px;background:#faf8f5}
.kathy-msg{max-width:85%;padding:12px 16px;font-size:0.9rem;line-height:1.5;animation:kathyFadeIn 0.3s ease}
.kathy-msg-bot{align-self:flex-start;background:#fff;color:#162d38;border-radius:4px 16px 16px 16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
.kathy-msg-user{align-self:flex-end;background:#cc624c;color:#fff;border-radius:16px 4px 16px 16px}
.kathy-msg-bot a{color:#cc624c;text-decoration:underline}
.kathy-typing{align-self:flex-start;background:#fff;border-radius:4px 16px 16px 16px;padding:12px 18px;box-shadow:0 1px 4px rgba(0,0,0,0.06);display:none}
.kathy-typing.active{display:flex;gap:4px;align-items:center}
.kathy-typing-dot{width:7px;height:7px;border-radius:50%;background:#c4b8a8;animation:kathyBounce 1.2s infinite}
.kathy-typing-dot:nth-child(2){animation-delay:0.15s}
.kathy-typing-dot:nth-child(3){animation-delay:0.3s}
@keyframes kathyBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
@keyframes kathyFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.kathy-input-wrap{padding:12px 16px;border-top:1px solid #f0ece6;display:flex;gap:8px;background:#fff}
.kathy-input{flex:1;font-family:Jost,sans-serif;font-size:0.9rem;padding:10px 14px;border:1px solid #e0d8cc;border-radius:20px;background:#faf8f5;color:#162d38;outline:none;resize:none;max-height:80px}
.kathy-input:focus{border-color:#cc624c}
.kathy-send{width:38px;height:38px;border-radius:50%;background:#cc624c;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;flex-shrink:0}
.kathy-send:hover{background:#d97965}
.kathy-send:disabled{background:#e0d8cc;cursor:not-allowed}
.kathy-send svg{width:18px;height:18px;fill:#fff}
.kathy-listing{background:#f7f5f2;border-radius:10px;padding:10px;margin-top:8px;display:flex;gap:10px;cursor:pointer;transition:background 0.2s}
.kathy-listing:hover{background:#f0ece6}
.kathy-listing img{width:70px;height:52px;border-radius:6px;object-fit:cover;flex-shrink:0}
.kathy-listing-info{font-size:0.82rem;line-height:1.4}
.kathy-listing-price{font-weight:600;color:#162d38}
.kathy-listing-addr{color:#6a8290}
.kathy-listing-details{color:#6a8290;font-size:0.78rem}
@media(max-width:480px){
  .kathy-window{right:0;bottom:0;left:0;width:100%;max-height:100%;border-radius:0}
  .kathy-toggle{bottom:16px;right:16px;width:54px;height:54px}
}`;
  document.head.appendChild(style);

  // Build widget HTML
  var widget = document.createElement('div');
  widget.id = 'kathyChat';
  widget.innerHTML = `
<button class="kathy-toggle" id="kathyToggle" aria-label="Chat with Kathy">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  <div class="kathy-badge" id="kathyBadge"></div>
</button>
<div class="kathy-window" id="kathyWindow">
  <div class="kathy-header">
    <div class="kathy-avatar">K</div>
    <div class="kathy-header-info">
      <div class="kathy-header-name">Kathy</div>
      <div class="kathy-header-status">Real Estate Assistant</div>
    </div>
    <button class="kathy-close" id="kathyClose">&times;</button>
  </div>
  <div class="kathy-messages" id="kathyMessages">
    <div class="kathy-typing" id="kathyTyping">
      <div class="kathy-typing-dot"></div>
      <div class="kathy-typing-dot"></div>
      <div class="kathy-typing-dot"></div>
    </div>
  </div>
  <div class="kathy-input-wrap">
    <textarea class="kathy-input" id="kathyInput" placeholder="Ask me anything about Phoenix real estate..." rows="1"></textarea>
    <button class="kathy-send" id="kathySend" aria-label="Send">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>
</div>`;
  document.body.appendChild(widget);

  var toggleBtn = document.getElementById('kathyToggle');
  var chatWindow = document.getElementById('kathyWindow');
  var closeBtn = document.getElementById('kathyClose');
  var messagesEl = document.getElementById('kathyMessages');
  var typingEl = document.getElementById('kathyTyping');
  var inputEl = document.getElementById('kathyInput');
  var sendBtn = document.getElementById('kathySend');
  var badge = document.getElementById('kathyBadge');

  // Restore previous messages into the DOM
  if(messages.length > 0){
    messages.forEach(function(m){
      renderMessage(m.content, m.role === 'assistant' ? 'bot' : 'user');
    });
  }

  // Restore open state
  if(chatOpen){
    chatWindow.classList.add('open');
    if(messages.length === 0) addBotMessage(getGreeting());
  }

  // Toggle chat
  toggleBtn.addEventListener('click', function(){
    chatOpen = !chatOpen;
    chatWindow.classList.toggle('open', chatOpen);
    saveChat();
    badge.style.display = 'none';
    if(chatOpen && messages.length === 0){
      addBotMessage(getGreeting());
    }
    if(chatOpen) inputEl.focus();
  });

  closeBtn.addEventListener('click', function(){
    chatOpen = false;
    chatWindow.classList.remove('open');
    saveChat();
  });

  // Auto-grow textarea
  inputEl.addEventListener('input', function(){
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  // Send on Enter (Shift+Enter for newline)
  inputEl.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  function getGreeting(){
    var page = document.title || '';
    var hour = new Date().getHours();
    var timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    if(location.pathname.indexOf('property.html') !== -1){
      return timeGreet + "! I'm Kathy. I see you're looking at a property — do you have any questions about it, or would you like to see similar homes?";
    }
    if(location.pathname.indexOf('neighborhoods.html') !== -1){
      return timeGreet + "! I'm Kathy from Camelback Home Group. Looking for homes in a particular area? I can help you find listings that match what you're looking for.";
    }
    if(location.pathname.indexOf('city.html') !== -1){
      return timeGreet + "! I'm Kathy. Want to know more about this area, or are you looking for homes here? I'd love to help!";
    }
    return timeGreet + "! I'm Kathy, your real estate assistant at Camelback Home Group. Whether you're buying, selling, or just exploring — I'm here to help. What can I do for you?";
  }

  function addBotMessage(text){
    messages.push({role: 'assistant', content: text});
    saveChat();
    renderMessage(text, 'bot');
  }

  function addUserMessage(text){
    messages.push({role: 'user', content: text});
    saveChat();
    renderMessage(text, 'user');
  }

  function renderMessage(text, type){
    var div = document.createElement('div');
    div.className = 'kathy-msg kathy-msg-' + type;
    div.innerHTML = formatMessage(text);
    messagesEl.insertBefore(div, typingEl);
    scrollToBottom();
  }

  function formatMessage(text){
    // Convert markdown-style links [text](url) to HTML
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // Convert **bold** to <strong>
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Convert newlines to <br>
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function scrollToBottom(){
    setTimeout(function(){ messagesEl.scrollTop = messagesEl.scrollHeight; }, 50);
  }

  function showTyping(){ typingEl.classList.add('active'); scrollToBottom(); }
  function hideTyping(){ typingEl.classList.remove('active'); }

  function getPageContext(){
    var ctx = document.title;
    if(location.pathname.indexOf('property.html') !== -1){
      var params = new URLSearchParams(location.search);
      var propId = params.get('id');
      if(propId) ctx += ' | property.html?id=' + propId + ' (use get_listing with mlsId "' + propId + '" to pull details)';
      var addr = document.querySelector('.property-address');
      var price = document.getElementById('propPrice');
      if(addr) ctx += ' — ' + addr.textContent;
      if(price) ctx += ' (' + price.textContent + ')';
    }
    return ctx;
  }

  function sendMessage(){
    var text = inputEl.value.trim();
    if(!text || isTyping) return;

    addUserMessage(text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    isTyping = true;
    sendBtn.disabled = true;
    showTyping();

    // Build conversation for API (skip the initial greeting which was client-side)
    var apiMessages = messages.slice(1).map(function(m){
      return { role: m.role, content: m.content };
    });

    var siteUser = typeof window.chgGetUser === 'function' ? window.chgGetUser() : null;

    fetch('/.netlify/functions/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        pageContext: getPageContext(),
        sessionId: sessionId,
        email: siteUser ? siteUser.email : ''
      })
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      hideTyping();
      isTyping = false;
      sendBtn.disabled = false;
      console.log('[Kathy] Response:', data);
      if(data.reply){
        addBotMessage(data.reply);
      } else if(data.error){
        console.error('[Kathy] Error:', data.error, data.detail);
        if(data.error === 'Chat not configured'){
          addBotMessage("I'm still getting set up! In the meantime, you can reach our team at **(480) 203-3039**.");
        } else {
          addBotMessage("I'm having a little trouble right now. You can always reach our team directly at **(480) 203-3039**!");
        }
      }
    })
    .catch(function(err){
      hideTyping();
      isTyping = false;
      sendBtn.disabled = false;
      console.error('[Kathy] Fetch error:', err);
      addBotMessage("I'm having a little trouble connecting. Try again in a moment, or call us at **(480) 203-3039**!");
    });
  }

  // Auto-open after 30 seconds if not already opened
  setTimeout(function(){
    if(!chatOpen && messages.length === 0){
      badge.style.display = 'flex';
    }
  }, 30000);

})();
