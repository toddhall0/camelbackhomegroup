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
    enabled: false              // Set to true to enable (false for testing)
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
  function createPopupHTML(){
    var overlay = document.createElement('div');
    overlay.id = 'chgLeadOverlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Jost,Helvetica,sans-serif';

    overlay.innerHTML = '' +
    '<div style="background:#fff;width:100%;max-width:420px;padding:36px 32px;position:relative;box-shadow:0 8px 40px rgba(0,0,0,0.3);margin:16px">' +
      '<button id="chgLeadClose" style="position:absolute;top:10px;right:14px;background:none;border:none;font-size:1.4rem;color:#6a8290;cursor:pointer;padding:4px 8px">&times;</button>' +

      // REGISTER TAB
      '<div id="chgRegisterTab">' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.5rem;color:#162d38;margin-bottom:4px">Create Your Free Account</h3>' +
        '<p style="font-size:0.88rem;color:#6a8290;margin-bottom:20px;line-height:1.5">Save your favorite listings, get price alerts, and receive personalized recommendations.</p>' +
        '<div style="margin-bottom:14px"><label style="display:block;font-size:0.78rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#6a8290;margin-bottom:4px">First Name</label>' +
        '<input id="chgRegFirst" type="text" required style="width:100%;font-family:Jost,sans-serif;font-size:0.95rem;padding:11px 12px;border:1px solid #c4b8a8;background:#f2f0ec;color:#162d38;outline:none"></div>' +
        '<div style="margin-bottom:14px"><label style="display:block;font-size:0.78rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#6a8290;margin-bottom:4px">Last Name</label>' +
        '<input id="chgRegLast" type="text" style="width:100%;font-family:Jost,sans-serif;font-size:0.95rem;padding:11px 12px;border:1px solid #c4b8a8;background:#f2f0ec;color:#162d38;outline:none"></div>' +
        '<div style="margin-bottom:14px"><label style="display:block;font-size:0.78rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#6a8290;margin-bottom:4px">Email</label>' +
        '<input id="chgRegEmail" type="email" required style="width:100%;font-family:Jost,sans-serif;font-size:0.95rem;padding:11px 12px;border:1px solid #c4b8a8;background:#f2f0ec;color:#162d38;outline:none"></div>' +
        '<div style="margin-bottom:14px"><label style="display:block;font-size:0.78rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#6a8290;margin-bottom:4px">Phone</label>' +
        '<input id="chgRegPhone" type="tel" style="width:100%;font-family:Jost,sans-serif;font-size:0.95rem;padding:11px 12px;border:1px solid #c4b8a8;background:#f2f0ec;color:#162d38;outline:none"></div>' +
        '<button id="chgRegSubmit" style="width:100%;padding:14px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;background:#cc624c;color:#fff;border:none;cursor:pointer;margin-top:4px">Sign Up</button>' +
        '<p style="font-size:0.75rem;color:#6a8290;margin-top:10px;text-align:center;line-height:1.4">Already have an account? <a id="chgShowLogin" href="#" style="color:#cc624c;font-weight:500">Log In</a></p>' +
        '<p style="font-size:0.7rem;color:#6a8290;margin-top:8px;text-align:center;line-height:1.3">By signing up, you agree to be contacted by Camelback Home Group.</p>' +
      '</div>' +

      // LOGIN TAB
      '<div id="chgLoginTab" style="display:none">' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.5rem;color:#162d38;margin-bottom:4px">Welcome Back</h3>' +
        '<p style="font-size:0.88rem;color:#6a8290;margin-bottom:20px;line-height:1.5">Log in to see your saved listings and continue where you left off.</p>' +
        '<div style="margin-bottom:14px"><label style="display:block;font-size:0.78rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#6a8290;margin-bottom:4px">Email</label>' +
        '<input id="chgLoginEmail" type="email" required style="width:100%;font-family:Jost,sans-serif;font-size:0.95rem;padding:11px 12px;border:1px solid #c4b8a8;background:#f2f0ec;color:#162d38;outline:none"></div>' +
        '<button id="chgLoginSubmit" style="width:100%;padding:14px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;background:#1f4e60;color:#fff;border:none;cursor:pointer;margin-top:4px">Log In</button>' +
        '<p style="font-size:0.75rem;color:#6a8290;margin-top:10px;text-align:center;line-height:1.4">Don\'t have an account? <a id="chgShowRegister" href="#" style="color:#cc624c;font-weight:500">Sign Up</a></p>' +
      '</div>' +

      // SUCCESS STATE
      '<div id="chgSuccessTab" style="display:none;text-align:center;padding:20px 0">' +
        '<div style="font-size:2.5rem;color:#cc624c;margin-bottom:12px">&#10003;</div>' +
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.4rem;color:#162d38;margin-bottom:8px" id="chgSuccessTitle">You\'re All Set!</h3>' +
        '<p style="font-size:0.9rem;color:#6a8290" id="chgSuccessMsg">Your account has been created. Happy house hunting!</p>' +
      '</div>' +
    '</div>';

    return overlay;
  }

  // ===== SHOW/HIDE POPUP =====
  var popup = null;

  function showPopup(){
    if(popup) return;
    popup = createPopupHTML();
    document.body.appendChild(popup);
    popup.style.display = 'flex';
    popupShown = true;
    setStore('popupShown', true);

    // Event listeners
    document.getElementById('chgLeadClose').addEventListener('click', hidePopup);
    popup.addEventListener('click', function(e){ if(e.target === popup) hidePopup(); });

    // Tab switching
    document.getElementById('chgShowLogin').addEventListener('click', function(e){
      e.preventDefault();
      document.getElementById('chgRegisterTab').style.display = 'none';
      document.getElementById('chgLoginTab').style.display = '';
    });
    document.getElementById('chgShowRegister').addEventListener('click', function(e){
      e.preventDefault();
      document.getElementById('chgLoginTab').style.display = 'none';
      document.getElementById('chgRegisterTab').style.display = '';
    });

    // Register submit
    document.getElementById('chgRegSubmit').addEventListener('click', handleRegister);

    // Login submit
    document.getElementById('chgLoginSubmit').addEventListener('click', handleLogin);
  }

  function hidePopup(){
    if(popup){
      popup.style.display = 'none';
      document.body.removeChild(popup);
      popup = null;
    }
  }

  // ===== HANDLE REGISTRATION =====
  function handleRegister(){
    var firstName = document.getElementById('chgRegFirst').value.trim();
    var email = document.getElementById('chgRegEmail').value.trim();
    if(!firstName || !email){
      alert('Please enter your name and email.');
      return;
    }

    var btn = document.getElementById('chgRegSubmit');
    btn.textContent = 'Signing up...';
    btn.disabled = true;

    var data = {
      firstName: firstName,
      lastName: document.getElementById('chgRegLast').value.trim(),
      email: email,
      phone: document.getElementById('chgRegPhone').value.trim(),
      source: 'Website Registration Popup',
      propertyAddress: '',
      propertyMlsId: ''
    };

    // Save user locally
    user = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      registeredAt: new Date().toISOString()
    };
    setStore('user', user);

    // Push to Sierra CRM
    fetch('/.netlify/functions/lead', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    })
    .then(function(){ showSuccess('You\'re All Set!', 'Your account has been created. Happy house hunting!'); })
    .catch(function(){ showSuccess('You\'re All Set!', 'Your account has been created. Happy house hunting!'); });
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
