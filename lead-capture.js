/* ===== Lead Capture + User Tracking System =====
 * Triggers registration popup after engagement threshold.
 * Tracks user activity across sessions.
 * Pushes leads to Sierra CRM.
 *
 * TESTING: Set window.CHG_LEAD_CAPTURE_ENABLED = false to disable.
 * Default: disabled (set to true to enable)
 */

(function(){
  // ===== CONFIGURATION =====
  var CONFIG = {
    pageViewThreshold: 2,       // Show popup after this many page views
    listingClickThreshold: 2,   // OR after this many listing clicks
    cookieDays: 30,             // Remember logged-in user for this many days
    enabled: true               // Lead capture is active
  };

  // Allow runtime override
  if(typeof window.CHG_LEAD_CAPTURE_ENABLED !== 'undefined'){
    CONFIG.enabled = window.CHG_LEAD_CAPTURE_ENABLED;
  }

  // ===== STORAGE HELPERS =====
  function getStore(key, def){
    try { var v = localStorage.getItem('chg_'+key); return v ? JSON.parse(v) : def; }
    catch(e){ return def; }
  }
  function setStore(key, val){
    try { localStorage.setItem('chg_'+key, JSON.stringify(val)); } catch(e){}
  }

  // ===== USER STATE =====
  var user = getStore('user', null); // {firstName, lastName, email, phone, registeredAt}
  var stats = getStore('stats', {pageViews: 0, listingClicks: 0, viewedListings: [], lastVisit: null});
  var popupShown = getStore('popupShown', false);

  // Update stats
  stats.pageViews++;
  stats.lastVisit = new Date().toISOString();
  setStore('stats', stats);

  // ===== TRACK LISTING CLICKS =====
  window.chgTrackListingClick = function(listingId){
    stats.listingClicks++;
    if(listingId && stats.viewedListings.indexOf(listingId) === -1){
      stats.viewedListings.push(listingId);
      if(stats.viewedListings.length > 50) stats.viewedListings = stats.viewedListings.slice(-50);
    }
    setStore('stats', stats);

    // Track for logged-in users
    if(user){
      trackActivity('listing_view', listingId);
    }

    checkThreshold();
  };

  // ===== CHECK IF THRESHOLD MET =====
  function checkThreshold(){
    if(!CONFIG.enabled) return;
    if(user) return; // Already registered
    if(popupShown) return; // Already shown this session

    if(stats.pageViews >= CONFIG.pageViewThreshold || stats.listingClicks >= CONFIG.listingClickThreshold){
      setTimeout(showPopup, 500);
    }
  }

  // ===== TRACK ACTIVITY =====
  function trackActivity(type, data){
    if(!user) return;
    var activity = getStore('activity', []);
    activity.push({type: type, data: data, time: new Date().toISOString()});
    if(activity.length > 100) activity = activity.slice(-100);
    setStore('activity', activity);
  }

  // ===== CREATE POPUP =====
  var inputStyle = 'width:100%;font-family:Jost,sans-serif;font-size:1rem;padding:14px 16px;border:1px solid #e0d8cc;background:#faf8f5;color:#162d38;outline:none;border-radius:8px;transition:border-color 0.2s';
  var labelStyle = 'display:block;font-size:0.78rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#6a8290;margin-bottom:6px';
  var btnStyle = 'width:100%;padding:15px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#fff;border:none;cursor:pointer;margin-top:8px;transition:all 0.2s;border-radius:8px';
  var btnBackStyle = 'width:100%;padding:13px;font-family:Jost,sans-serif;font-size:0.88rem;font-weight:400;color:#6a8290;background:transparent;border:none;cursor:pointer;margin-top:4px;transition:color 0.2s';
  var dotActive = 'width:10px;height:10px;border-radius:50%;background:#cc624c;transition:background 0.3s';
  var dotInactive = 'width:10px;height:10px;border-radius:50%;background:#e0d8cc;transition:background 0.3s';

  function createPopupHTML(){
    var overlay = document.createElement('div');
    overlay.id = 'chgLeadOverlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Jost,Helvetica,sans-serif';

    overlay.innerHTML = '' +
    '<div style="background:#fff;width:100%;max-width:400px;padding:40px 36px;position:relative;box-shadow:0 12px 48px rgba(0,0,0,0.2);margin:16px;border-radius:16px">' +
      '<button id="chgLeadClose" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:1.5rem;color:#c4b8a8;cursor:pointer;padding:4px 8px;transition:color 0.2s">&times;</button>' +

      // STEP DOTS
      '<div id="chgDots" style="display:flex;justify-content:center;gap:8px;margin-bottom:24px">' +
        '<div id="chgDot1" style="' + dotActive + '"></div>' +
        '<div id="chgDot2" style="' + dotInactive + '"></div>' +
        '<div id="chgDot3" style="' + dotInactive + '"></div>' +
      '</div>' +

      // STEP 1: NAME
      '<div id="chgStep1">' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">What\'s your name?</h3>' +
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">Create a free account to save listings and get personalized updates.</p>' +
        '<div style="margin-bottom:16px"><label style="' + labelStyle + '">Full Name</label>' +
        '<input id="chgRegName" type="text" placeholder="First Last" style="' + inputStyle + '"></div>' +
        '<button id="chgStep1Next" style="' + btnStyle + ';background:#cc624c">Next</button>' +
        '<p style="font-size:0.82rem;color:#6a8290;margin-top:16px;text-align:center;line-height:1.4">Already have an account? <a id="chgShowLogin" href="#" style="color:#cc624c;font-weight:500">Log In</a></p>' +
      '</div>' +

      // STEP 2: EMAIL
      '<div id="chgStep2" style="display:none">' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">What\'s your email?</h3>' +
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">We\'ll send you listing alerts and market updates.</p>' +
        '<div style="margin-bottom:16px"><label style="' + labelStyle + '">Email Address</label>' +
        '<input id="chgRegEmail" type="email" placeholder="you@example.com" style="' + inputStyle + '"></div>' +
        '<button id="chgStep2Next" style="' + btnStyle + ';background:#cc624c">Next</button>' +
        '<button id="chgStep2Back" style="' + btnBackStyle + '">&larr; Back</button>' +
      '</div>' +

      // STEP 3: PHONE
      '<div id="chgStep3" style="display:none">' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">Almost done!</h3>' +
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">Add your phone so an agent can reach you about properties you love.</p>' +
        '<div style="margin-bottom:16px"><label style="' + labelStyle + '">Phone <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>' +
        '<input id="chgRegPhone" type="tel" placeholder="(480) 555-1234" style="' + inputStyle + '"></div>' +
        '<button id="chgStep3Submit" style="' + btnStyle + ';background:#cc624c">Create My Account</button>' +
        '<button id="chgStep3Back" style="' + btnBackStyle + '">&larr; Back</button>' +
        '<p style="font-size:0.72rem;color:#b0a898;margin-top:14px;text-align:center;line-height:1.4">By signing up, you agree to be contacted by Camelback Home Group.</p>' +
      '</div>' +

      // LOGIN TAB
      '<div id="chgLoginTab" style="display:none">' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">Welcome Back</h3>' +
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">Log in to see your saved listings and continue where you left off.</p>' +
        '<div style="margin-bottom:16px"><label style="' + labelStyle + '">Email Address</label>' +
        '<input id="chgLoginEmail" type="email" placeholder="you@example.com" style="' + inputStyle + '"></div>' +
        '<button id="chgLoginSubmit" style="' + btnStyle + ';background:#1f4e60">Log In</button>' +
        '<p style="font-size:0.82rem;color:#6a8290;margin-top:16px;text-align:center;line-height:1.4">Don\'t have an account? <a id="chgShowRegister" href="#" style="color:#cc624c;font-weight:500">Sign Up</a></p>' +
      '</div>' +

      // SUCCESS STATE
      '<div id="chgSuccessTab" style="display:none;text-align:center;padding:24px 0">' +
        '<div style="font-size:3rem;margin-bottom:14px">&#127968;</div>' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.5rem;color:#162d38;margin-bottom:8px" id="chgSuccessTitle">You\'re All Set!</h3>' +
        '<p style="font-size:0.92rem;color:#6a8290" id="chgSuccessMsg">Your account has been created. Happy house hunting!</p>' +
      '</div>' +
    '</div>';

    return overlay;
  }

  // ===== SHOW/HIDE POPUP =====
  var popup = null;
  var partialData = {};

  function setDots(step){
    for(var d=1;d<=3;d++){
      var dot = document.getElementById('chgDot'+d);
      if(dot) dot.style.background = d <= step ? '#cc624c' : '#d4c4a8';
    }
  }

  function showStep(n){
    for(var s=1;s<=3;s++){
      var el = document.getElementById('chgStep'+s);
      if(el) el.style.display = s===n ? '' : 'none';
    }
    document.getElementById('chgLoginTab').style.display = 'none';
    document.getElementById('chgSuccessTab').style.display = 'none';
    document.getElementById('chgDots').style.display = '';
    setDots(n);
  }

  function pushPartialToCRM(data){
    fetch('/.netlify/functions/lead', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    }).catch(function(){});
  }

  function showPopup(){
    if(popup) return;
    popup = createPopupHTML();
    document.body.appendChild(popup);
    popup.style.display = 'flex';
    popupShown = true;
    setStore('popupShown', true);
    partialData = {};

    // Close
    document.getElementById('chgLeadClose').addEventListener('click', hidePopup);
    popup.addEventListener('click', function(e){ if(e.target === popup) hidePopup(); });

    // STEP 1 → STEP 2
    document.getElementById('chgStep1Next').addEventListener('click', function(){
      var name = document.getElementById('chgRegName').value.trim();
      if(!name){ document.getElementById('chgRegName').style.borderColor='#cc624c'; return; }
      var parts = name.split(/\s+/);
      partialData.firstName = parts[0] || '';
      partialData.lastName = parts.slice(1).join(' ') || '';
      partialData.source = 'Website Registration Popup (partial - name only)';
      // Capture partial — just name
      pushPartialToCRM(partialData);
      showStep(2);
      document.getElementById('chgRegEmail').focus();
    });

    // STEP 2 → STEP 3
    document.getElementById('chgStep2Next').addEventListener('click', function(){
      var email = document.getElementById('chgRegEmail').value.trim();
      if(!email || email.indexOf('@') === -1){ document.getElementById('chgRegEmail').style.borderColor='#cc624c'; return; }
      partialData.email = email;
      partialData.source = 'Website Registration Popup (partial - name + email)';
      // Capture partial — name + email
      pushPartialToCRM(partialData);
      showStep(3);
      document.getElementById('chgRegPhone').focus();
    });

    // STEP 2 BACK
    document.getElementById('chgStep2Back').addEventListener('click', function(){ showStep(1); });

    // STEP 3 SUBMIT
    var step3btn = document.getElementById('chgStep3Submit');
    if(step3btn){
      step3btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        partialData.phone = document.getElementById('chgRegPhone').value.trim();
        partialData.source = 'Website Registration Popup';
      // Final push with all data
      pushPartialToCRM(partialData);
      // Save user locally
      user = {
        firstName: partialData.firstName,
        lastName: partialData.lastName,
        email: partialData.email,
        phone: partialData.phone,
        registeredAt: new Date().toISOString()
      };
      setStore('user', user);
      showSuccess('You\'re All Set!', 'Your account has been created. Happy house hunting!');
      });
    }

    // STEP 3 BACK
    document.getElementById('chgStep3Back').addEventListener('click', function(){ showStep(2); });

    // SHOW LOGIN
    document.getElementById('chgShowLogin').addEventListener('click', function(e){
      e.preventDefault();
      document.getElementById('chgStep1').style.display = 'none';
      document.getElementById('chgDots').style.display = 'none';
      document.getElementById('chgLoginTab').style.display = '';
    });

    // SHOW REGISTER (from login)
    document.getElementById('chgShowRegister').addEventListener('click', function(e){
      e.preventDefault();
      showStep(1);
    });

    // LOGIN SUBMIT
    document.getElementById('chgLoginSubmit').addEventListener('click', handleLogin);
  }

  function hidePopup(){
    if(popup){
      popup.style.display = 'none';
      document.body.removeChild(popup);
      popup = null;
    }
  }

  // ===== HANDLE LOGIN =====
  function handleLogin(){
    var email = document.getElementById('chgLoginEmail').value.trim();
    if(!email){
      alert('Please enter your email.');
      return;
    }

    // Simple email-based login (check localStorage)
    user = { email: email, firstName: '', lastName: '', phone: '', registeredAt: new Date().toISOString() };
    setStore('user', user);

    showSuccess('Welcome Back!', 'You\'re now logged in. We\'ll track your favorites and send you updates.');
  }

  function showSuccess(title, msg){
    document.getElementById('chgRegisterTab').style.display = 'none';
    document.getElementById('chgLoginTab').style.display = 'none';
    document.getElementById('chgSuccessTab').style.display = '';
    document.getElementById('chgSuccessTitle').textContent = title;
    document.getElementById('chgSuccessMsg').textContent = msg;
    setTimeout(hidePopup, 2500);
  }

  // ===== AUTO-TRACK LISTING CLICKS =====
  // Intercept clicks on property links
  document.addEventListener('click', function(e){
    var link = e.target.closest('a[href*="property.html"], .listing-card, .listing-prev-card, .result-card');
    if(link){
      var href = link.getAttribute('href') || '';
      var match = href.match(/id=(\d+)/);
      if(match){
        window.chgTrackListingClick(match[1]);
      } else {
        window.chgTrackListingClick('unknown');
      }
    }
  });

  // ===== SHOW LOGIN BUTTON IF USER EXISTS =====
  // Add a small "Hi, FirstName" or "Sign In" to the nav
  window.chgGetUser = function(){ return user; };
  window.chgLogout = function(){
    user = null;
    setStore('user', null);
    setStore('popupShown', false);
    stats.listingClicks = 0;
    stats.pageViews = 0;
    setStore('stats', stats);
  };
  window.chgShowSignup = function(){ showPopup(); };

  // ===== INITIAL THRESHOLD CHECK =====
  checkThreshold();
})();
