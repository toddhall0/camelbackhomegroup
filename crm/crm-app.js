/* Shared dashboard logic: Supabase client, agent auth, navigation, helpers.
   Lead names, messages and URLs arrive from the public website, so anything
   from the database goes through CRM.esc before it reaches innerHTML. */
window.CRM = (function(){
  var STATUSES = [
    ['new','New'],['contacted','Contacted'],['qualified','Qualified'],['showing','Showing'],
    ['under_contract','Under Contract'],['closed_won','Closed Won'],['closed_lost','Closed Lost'],['nurture','Nurture']
  ];
  var LEAD_TYPES = [['buyer','Buyer'],['seller','Seller'],['both','Buyer & Seller'],['investor','Investor']];
  var SOURCES = [['website','Website'],['chat','Chat'],['property_inquiry','Property Inquiry'],['referral','Referral'],['manual','Manual']];

  // Named columns, never '*': agents have no access to leads.password_hash
  var LEAD_COLUMNS = 'id,first_name,last_name,email,phone,source,source_detail,landing_page,status,lead_type,'+
    'assigned_agent_id,score,preferred_cities,min_price,max_price,total_page_views,total_listing_views,'+
    'total_favorites,last_active_at,short_summary,email_opt_out,tags,created_at';

  var NAV = [
    ['index.html','Dashboard','M3 12l9-8 9 8M5 10v10h14V10'],
    ['leads.html','Leads','M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8']
  ];

  var db = null, agent = null;

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function label(list, value){
    for(var i=0;i<list.length;i++){ if(list[i][0]===value) return list[i][1]; }
    return value || '';
  }
  function options(list, selected){
    return list.map(function(o){
      return '<option value="'+esc(o[0])+'"'+(o[0]===selected?' selected':'')+'>'+esc(o[1])+'</option>';
    }).join('');
  }
  function leadName(lead){
    if(!lead) return 'Unknown lead';
    var name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
    return name || lead.email || lead.phone || 'Unnamed lead';
  }
  function agentName(a){ return a ? a.first_name+' '+a.last_name : 'Unassigned'; }
  function formatDate(value){
    if(!value) return '—';
    return new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }
  function formatDateTime(value){
    if(!value) return '—';
    return new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function timeAgo(value){
    if(!value) return '—';
    var minutes = Math.floor((Date.now()-new Date(value).getTime())/60000);
    if(minutes < 1) return 'just now';
    if(minutes < 60) return minutes+'m ago';
    if(minutes < 1440) return Math.floor(minutes/60)+'h ago';
    if(minutes < 43200) return Math.floor(minutes/1440)+'d ago';
    return formatDate(value);
  }
  function money(n){ return n ? '$'+Number(n).toLocaleString('en-US') : '—'; }
  function scoreBadge(score){
    var s = score || 0;
    var tier = s > 60 ? ['fire','On Fire'] : s > 30 ? ['hot','Hot'] : s > 10 ? ['warm','Warm'] : ['cold','Cold'];
    return '<span class="crm-badge crm-score-'+tier[0]+'">'+tier[1]+' '+esc(s)+'</span>';
  }
  function statusBadge(status){
    return '<span class="crm-badge crm-status-'+esc(status)+'">'+esc(label(STATUSES,status))+'</span>';
  }
  // Only http(s) links are clickable, so a stored javascript: URL can't run
  function safeUrl(url){ return /^https?:\/\//i.test(url || '') ? url : ''; }
  function describeActivity(a){
    var where = a.property_address || (a.mls_number ? 'MLS# '+a.mls_number : a.property_id ? 'listing '+a.property_id : 'a listing');
    switch(a.type){
      case 'lead_created': return 'Lead created';
      case 'listing_view': return 'Viewed '+where;
      case 'site_visit': case 'page_view': return 'Visited the website';
      case 'favorite_add': return 'Saved '+where;
      case 'favorite_remove': return 'Removed '+where+' from favorites';
      case 'property_inquiry': return 'Asked about '+where;
      case 'form_submit': return 'Submitted a form';
      case 'chat_message': return 'Chatted with Kathy';
      case 'note': return 'Note';
      case 'status_change': return 'Status changed';
      case 'agent_assigned': return 'Agent assigned';
      default: return a.type.replace(/_/g,' ');
    }
  }
  function toast(message, isError){
    var el = document.createElement('div');
    el.className = 'crm-toast'+(isError?' crm-toast-error':'');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function(){ el.remove(); }, 4000);
  }
  function showFatal(message){
    document.body.innerHTML = '<div class="crm-center"><div class="crm-card crm-login-card"><h1>Camelback CRM</h1><p>'+esc(message)+'</p>'+
      '<p><a href="login.html">Back to login</a></p></div></div>';
  }

  async function getClient(){
    if(db) return db;
    var resp = await fetch('/.netlify/functions/crm-config');
    var config = await resp.json();
    if(!config.url || !config.anonKey) throw new Error('The CRM is not configured yet.');
    db = window.supabase.createClient(config.url, config.anonKey);
    return db;
  }

  async function signOut(){
    await db.auth.signOut();
    location.href = 'login.html';
  }

  function renderShell(active){
    var links = NAV.map(function(n){
      return '<a href="'+n[0]+'" class="'+(n[0]===active?'active':'')+'">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+n[2]+'"/></svg>'+
        '<span>'+n[1]+'</span></a>';
    }).join('');
    var nav = document.createElement('nav');
    nav.className = 'crm-nav';
    nav.innerHTML = '<div class="crm-brand">Camelback<small>CRM</small></div><div class="crm-nav-links">'+links+'</div>'+
      '<div class="crm-nav-user"><div>'+esc(agentName(agent))+'<small>'+esc(agent.role)+'</small></div>'+
      '<button class="crm-link-btn" id="crmSignOut">Sign out</button></div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.getElementById('crmSignOut').onclick = signOut;
  }

  // Page guard. Returns the logged-in agent, or redirects to login.
  async function start(active){
    try{
      await getClient();
      var session = (await db.auth.getSession()).data.session;
      if(!session){ location.href = 'login.html'; return null; }
      var result = await db.from('agents').select('id,first_name,last_name,email,role')
        .eq('auth_id', session.user.id).eq('is_active', true).maybeSingle();
      if(result.error) throw new Error(result.error.message);
      if(!result.data){
        await db.auth.signOut();
        showFatal('This login is not linked to an active agent. Ask your admin to add you.');
        return null;
      }
      agent = result.data;
      renderShell(active);
      return agent;
    }catch(err){
      showFatal('Could not load the CRM: '+err.message);
      return null;
    }
  }

  function closeModal(){
    var el = document.getElementById('crmModal');
    if(el) el.remove();
  }
  function openModal(title, bodyHtml){
    closeModal();
    var el = document.createElement('div');
    el.id = 'crmModal';
    el.className = 'crm-modal-wrap';
    el.innerHTML = '<div class="crm-modal"><div class="crm-modal-head"><h2>'+esc(title)+'</h2>'+
      '<button class="crm-link-btn" id="crmModalClose" aria-label="Close">&times;</button></div>'+bodyHtml+'</div>';
    document.body.appendChild(el);
    document.getElementById('crmModalClose').onclick = closeModal;
    el.addEventListener('click', function(e){ if(e.target===el) closeModal(); });
  }

  function openAddLead(){
    openModal('Add Lead',
      '<form id="crmAddLead" class="crm-form">'+
        '<div class="crm-form-row"><label>First name<input name="first_name"></label><label>Last name<input name="last_name"></label></div>'+
        '<label>Email<input name="email" type="email"></label>'+
        '<label>Phone<input name="phone" type="tel"></label>'+
        '<div class="crm-form-row"><label>Type<select name="lead_type">'+options(LEAD_TYPES,'buyer')+'</select></label>'+
        '<label>Source<select name="source">'+options(SOURCES,'manual')+'</select></label></div>'+
        '<label>First note<textarea name="note" rows="3"></textarea></label>'+
        '<button class="crm-btn" type="submit">Add Lead</button>'+
      '</form>');
    document.getElementById('crmAddLead').onsubmit = async function(e){
      e.preventDefault();
      var f = e.target;
      var email = f.email.value.trim().toLowerCase();
      var phone = f.phone.value.trim();
      if(!email && !phone){ toast('Enter an email or a phone number.', true); return; }
      var result = await db.from('leads').insert({
        first_name: f.first_name.value.trim() || null,
        last_name: f.last_name.value.trim() || null,
        email: email || null,
        phone: phone || null,
        lead_type: f.lead_type.value,
        source: f.source.value,
        source_detail: 'Added by '+agentName(agent),
        assigned_agent_id: agent.id
      }).select('id').single();
      if(result.error){
        toast(result.error.code==='23505' ? 'A lead with that email already exists.' : result.error.message, true);
        return;
      }
      var entries = [{lead_id:result.data.id, type:'lead_created', created_by:agent.id}];
      if(f.note.value.trim()) entries.push({lead_id:result.data.id, type:'note', message:f.note.value.trim(), created_by:agent.id});
      await db.from('activities').insert(entries);
      location.href = 'lead.html?id='+encodeURIComponent(result.data.id);
    };
  }

  return {
    STATUSES:STATUSES, LEAD_TYPES:LEAD_TYPES, SOURCES:SOURCES, LEAD_COLUMNS:LEAD_COLUMNS,
    esc:esc, label:label, options:options, leadName:leadName, agentName:agentName,
    formatDate:formatDate, formatDateTime:formatDateTime, timeAgo:timeAgo, money:money,
    scoreBadge:scoreBadge, statusBadge:statusBadge, safeUrl:safeUrl, describeActivity:describeActivity,
    toast:toast, getClient:getClient, start:start, openModal:openModal, closeModal:closeModal,
    openAddLead:openAddLead
  };
})();
