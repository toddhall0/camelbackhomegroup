/* Lead Capture + User Tracking for Camelback Home Group */
(function(){
  var CONFIG = { pageViewThreshold: 2, listingClickThreshold: 2, enabled: true };
  if(typeof window.CHG_LEAD_CAPTURE_ENABLED !== 'undefined') CONFIG.enabled = window.CHG_LEAD_CAPTURE_ENABLED;

  function gs(k,d){ try{var v=localStorage.getItem('chg_'+k);return v?JSON.parse(v):d}catch(e){return d} }
  function ss(k,v){ try{localStorage.setItem('chg_'+k,JSON.stringify(v))}catch(e){} }

  var user = gs('user',null);
  var stats = gs('stats',{pageViews:0,listingClicks:0,viewedListings:[],viewedPrices:[],viewedCities:{},lastVisit:null,sessions:0});
  var popupDismissed = gs('popupDismissed',false);
  stats.pageViews++; stats.sessions=(stats.sessions||0)+(gs('lastPage','')!==location.pathname?1:0); stats.lastVisit=new Date().toISOString(); ss('stats',stats); ss('lastPage',location.pathname);

  // Track a listing view with price and city data
  window.chgTrackListingClick=function(id,price,city){
    stats.listingClicks++;
    if(id&&stats.viewedListings.indexOf(id)===-1){
      stats.viewedListings.push(id);
      if(stats.viewedListings.length>100)stats.viewedListings=stats.viewedListings.slice(-100);
    }
    if(price&&price>0){
      stats.viewedPrices.push(price);
      if(stats.viewedPrices.length>100)stats.viewedPrices=stats.viewedPrices.slice(-100);
    }
    if(city){
      stats.viewedCities=stats.viewedCities||{};
      stats.viewedCities[city]=(stats.viewedCities[city]||0)+1;
    }
    ss('stats',stats);

    // If user is registered, push activity update to CRM periodically
    if(user&&user.email&&stats.listingClicks%5===0){
      var analytics = chgGetAnalytics();
      pushToCRM({
        email:user.email,firstName:user.firstName||'',lastName:user.lastName||'',
        source:'Activity Update',
        note:'Activity: '+stats.listingClicks+' listings viewed | Avg price: '+formatP(analytics.avgPrice)+' | Top city: '+analytics.topCity+' | Price range: '+formatP(analytics.minPrice)+'-'+formatP(analytics.maxPrice)+' | Sessions: '+stats.sessions
      });
    }

    checkThreshold();
  };

  function formatP(n){if(!n||n===0)return'N/A';if(n>=1000000)return'$'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'$'+(n/1000).toFixed(0)+'K';return'$'+n}

  // Get user analytics
  function chgGetAnalytics(){
    var prices=stats.viewedPrices||[];
    var cities=stats.viewedCities||{};
    var topCity='';var topCount=0;
    for(var c in cities){if(cities[c]>topCount){topCount=cities[c];topCity=c}}
    var sorted=prices.slice().sort(function(a,b){return a-b});
    return{
      totalViews:stats.listingClicks,
      uniqueListings:stats.viewedListings.length,
      avgPrice:prices.length?Math.round(prices.reduce(function(a,b){return a+b},0)/prices.length):0,
      medianPrice:sorted.length?sorted[Math.floor(sorted.length/2)]:0,
      minPrice:sorted.length?sorted[0]:0,
      maxPrice:sorted.length?sorted[sorted.length-1]:0,
      topCity:topCity||'N/A',
      citiesViewed:cities,
      totalSessions:stats.sessions||1,
      totalPageViews:stats.pageViews
    };
  }
  window.chgGetAnalytics=chgGetAnalytics;

  window.chgGetUser=function(){return user};
  window.chgLogout=function(){user=null;ss('user',null);ss('popupDismissed',false);stats={pageViews:0,listingClicks:0,viewedListings:[],viewedPrices:[],viewedCities:{},lastVisit:null,sessions:0};ss('stats',stats)};
  window.chgShowSignup=function(){showPopup()};

  function pushToCRM(d){fetch('/.netlify/functions/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).catch(function(){})}

  function checkThreshold(){
    if(!CONFIG.enabled||user||popupDismissed)return;
    if(stats.pageViews>=CONFIG.pageViewThreshold||stats.listingClicks>=CONFIG.listingClickThreshold)setTimeout(showPopup,500);
  }

  // Confetti
  function spawnConfetti(container,count,big){
    var colors=['#cc624c','#1f4e60','#d97965','#f2ddd7','#B8922A','#2d6b80'];
    for(var i=0;i<count;i++){
      var c=document.createElement('div');
      var sz=big?(Math.random()*10+6):(Math.random()*6+4);
      var x=Math.random()*100;
      var dur=Math.random()*1+0.8;
      var delay=Math.random()*0.3;
      var rot=Math.random()*360;
      c.style.cssText='position:absolute;top:-10px;left:'+x+'%;width:'+sz+'px;height:'+sz+'px;background:'+colors[Math.floor(Math.random()*colors.length)]+';border-radius:'+(Math.random()>0.5?'50%':'2px')+';opacity:0.9;animation:chgConfettiFall '+dur+'s ease-out '+delay+'s forwards;transform:rotate('+rot+'deg)';
      container.appendChild(c);
      setTimeout(function(el){el.remove()}.bind(null,c),(dur+delay)*1000+100);
    }
  }

  // Inject confetti keyframes
  var style=document.createElement('style');
  style.textContent='@keyframes chgConfettiFall{0%{opacity:1;transform:translateY(0) rotate(0deg)}100%{opacity:0;transform:translateY(320px) rotate(720deg)}}';
  document.head.appendChild(style);

  var popup=null, partialData={};

  function showPopup(){
    if(popup||user)return;
    var ov=document.createElement('div');
    ov.id='chgLeadOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Jost,Helvetica,sans-serif';

    ov.innerHTML='<div id="chgModal" style="background:#fff;width:100%;max-width:400px;padding:40px 36px;position:relative;box-shadow:0 16px 60px rgba(0,0,0,0.18);margin:16px;border-radius:20px;overflow:hidden">'+
      '<div id="chgConfettiZone" style="position:absolute;inset:0;pointer-events:none;overflow:hidden"></div>'+
      '<button id="chgX" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:1.5rem;color:#c4b8a8;cursor:pointer;z-index:2">&times;</button>'+
      '<div id="chgDots" style="display:flex;justify-content:center;gap:8px;margin-bottom:28px">'+
        '<div class="chgDot" style="width:10px;height:10px;border-radius:50%;background:#cc624c;transition:background 0.3s"></div>'+
        '<div class="chgDot" style="width:10px;height:10px;border-radius:50%;background:#e0d8cc;transition:background 0.3s"></div>'+
        '<div class="chgDot" style="width:10px;height:10px;border-radius:50%;background:#e0d8cc;transition:background 0.3s"></div>'+
      '</div>'+
      '<div id="chgS1">'+
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">What\'s your name?</h3>'+
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">Create a free account to save listings and get personalized updates.</p>'+
        '<input id="chgName" type="text" placeholder="First Last" style="width:100%;font-family:Jost,sans-serif;font-size:1rem;padding:14px 16px;border:1px solid #e0d8cc;background:#faf8f5;color:#162d38;outline:none;border-radius:10px;margin-bottom:16px">'+
        '<button id="chgN1" style="width:100%;padding:15px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.04em;background:#cc624c;color:#fff;border:none;cursor:pointer;border-radius:10px">Next</button>'+
        '<p style="font-size:0.82rem;color:#6a8290;margin-top:16px;text-align:center">Already have an account? <a id="chgToLogin" href="#" style="color:#cc624c;font-weight:500">Log In</a></p>'+
      '</div>'+
      '<div id="chgS2" style="display:none">'+
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">What\'s your email?</h3>'+
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">We\'ll send you listing alerts and market updates.</p>'+
        '<input id="chgEmail" type="email" placeholder="you@example.com" style="width:100%;font-family:Jost,sans-serif;font-size:1rem;padding:14px 16px;border:1px solid #e0d8cc;background:#faf8f5;color:#162d38;outline:none;border-radius:10px;margin-bottom:16px">'+
        '<button id="chgN2" style="width:100%;padding:15px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.04em;background:#cc624c;color:#fff;border:none;cursor:pointer;border-radius:10px">Next</button>'+
        '<button id="chgB2" style="width:100%;padding:12px;font-family:Jost,sans-serif;font-size:0.88rem;color:#6a8290;background:none;border:none;cursor:pointer;margin-top:4px">&larr; Back</button>'+
      '</div>'+
      '<div id="chgS3" style="display:none">'+
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">Almost done!</h3>'+
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">Add your phone so an agent can reach you about properties you love.</p>'+
        '<input id="chgPhone" type="tel" placeholder="(480) 555-1234" style="width:100%;font-family:Jost,sans-serif;font-size:1rem;padding:14px 16px;border:1px solid #e0d8cc;background:#faf8f5;color:#162d38;outline:none;border-radius:10px;margin-bottom:16px">'+
        '<button id="chgSubmit" style="width:100%;padding:15px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.04em;background:#cc624c;color:#fff;border:none;cursor:pointer;border-radius:10px">Create My Account</button>'+
        '<button id="chgB3" style="width:100%;padding:12px;font-family:Jost,sans-serif;font-size:0.88rem;color:#6a8290;background:none;border:none;cursor:pointer;margin-top:4px">&larr; Back</button>'+
        '<p style="font-size:0.72rem;color:#b0a898;margin-top:14px;text-align:center;line-height:1.4">By signing up, you agree to be contacted by Camelback Home Group.</p>'+
      '</div>'+
      '<div id="chgLogin" style="display:none">'+
        '<h3 style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.6rem;color:#162d38;margin-bottom:6px;text-align:center">Welcome Back</h3>'+
        '<p style="font-size:0.9rem;color:#6a8290;margin-bottom:24px;line-height:1.6;text-align:center">Log in with your email to continue.</p>'+
        '<input id="chgLoginEmail" type="email" placeholder="you@example.com" style="width:100%;font-family:Jost,sans-serif;font-size:1rem;padding:14px 16px;border:1px solid #e0d8cc;background:#faf8f5;color:#162d38;outline:none;border-radius:10px;margin-bottom:16px">'+
        '<button id="chgLoginBtn" style="width:100%;padding:15px;font-family:Jost,sans-serif;font-size:0.95rem;font-weight:500;letter-spacing:0.04em;background:#1f4e60;color:#fff;border:none;cursor:pointer;border-radius:10px">Log In</button>'+
        '<p style="font-size:0.82rem;color:#6a8290;margin-top:16px;text-align:center">Don\'t have an account? <a id="chgToReg" href="#" style="color:#cc624c;font-weight:500">Sign Up</a></p>'+
      '</div>'+
      '<div id="chgDone" style="display:none;text-align:center;padding:24px 0">'+
        '<div style="font-size:3rem;margin-bottom:14px">&#127968;</div>'+
        '<h3 id="chgDoneTitle" style="font-family:Cormorant Garamond,Georgia,serif;font-size:1.5rem;color:#162d38;margin-bottom:8px">You\'re All Set!</h3>'+
        '<p id="chgDoneMsg" style="font-size:0.92rem;color:#6a8290">Happy house hunting!</p>'+
      '</div>'+
    '</div>';

    document.body.appendChild(ov);
    popup=ov;
    popupDismissed=true; ss('popupDismissed',true);
    partialData={};

    var confZone=document.getElementById('chgConfettiZone');
    var dots=document.querySelectorAll('.chgDot');

    function setDots(n){dots.forEach(function(d,i){d.style.background=i<n?'#cc624c':'#e0d8cc'})}
    function showS(n){
      ['chgS1','chgS2','chgS3','chgLogin','chgDone'].forEach(function(id){document.getElementById(id).style.display='none'});
      document.getElementById('chgDots').style.display=n>0?'flex':'none';
      if(n===1){document.getElementById('chgS1').style.display='';setDots(1)}
      else if(n===2){document.getElementById('chgS2').style.display='';setDots(2)}
      else if(n===3){document.getElementById('chgS3').style.display='';setDots(3)}
    }

    // Close
    document.getElementById('chgX').onclick=function(){popup.remove();popup=null};
    ov.onclick=function(e){if(e.target===ov){popup.remove();popup=null}};

    // Step 1 → 2
    document.getElementById('chgN1').onclick=function(){
      var name=document.getElementById('chgName').value.trim();
      if(!name){document.getElementById('chgName').style.borderColor='#cc624c';return}
      var p=name.split(/\s+/);
      partialData.firstName=p[0]||'';partialData.lastName=p.slice(1).join(' ')||'';
      partialData.source='Website Popup (partial - name)';
      pushToCRM(partialData);
      spawnConfetti(confZone,15,false);
      showS(2);document.getElementById('chgEmail').focus();
    };

    // Step 2 → 3
    document.getElementById('chgN2').onclick=function(){
      var email=document.getElementById('chgEmail').value.trim();
      if(!email||email.indexOf('@')===-1){document.getElementById('chgEmail').style.borderColor='#cc624c';return}
      partialData.email=email;
      partialData.source='Website Popup (partial - name+email)';
      pushToCRM(partialData);
      spawnConfetti(confZone,20,false);
      showS(3);document.getElementById('chgPhone').focus();
    };

    // Step 2 back
    document.getElementById('chgB2').onclick=function(){showS(1)};

    // Step 3 submit
    document.getElementById('chgSubmit').onclick=function(){
      partialData.phone=document.getElementById('chgPhone').value.trim();
      partialData.source='Website Registration Popup';
      pushToCRM(partialData);
      user={firstName:partialData.firstName,lastName:partialData.lastName,email:partialData.email,phone:partialData.phone,registeredAt:new Date().toISOString()};
      ss('user',user);
      spawnConfetti(confZone,40,true);
      document.getElementById('chgDots').style.display='none';
      ['chgS1','chgS2','chgS3','chgLogin'].forEach(function(id){document.getElementById(id).style.display='none'});
      document.getElementById('chgDone').style.display='';
      setTimeout(function(){if(popup){popup.remove();popup=null}},3000);
    };

    // Step 3 back
    document.getElementById('chgB3').onclick=function(){showS(2)};

    // Login
    document.getElementById('chgToLogin').onclick=function(e){e.preventDefault();
      ['chgS1','chgS2','chgS3','chgDone'].forEach(function(id){document.getElementById(id).style.display='none'});
      document.getElementById('chgDots').style.display='none';
      document.getElementById('chgLogin').style.display='';
    };
    document.getElementById('chgToReg').onclick=function(e){e.preventDefault();showS(1)};
    document.getElementById('chgLoginBtn').onclick=function(){
      var email=document.getElementById('chgLoginEmail').value.trim();
      if(!email){return}
      user={email:email,firstName:'',lastName:'',phone:'',registeredAt:new Date().toISOString()};
      ss('user',user);
      spawnConfetti(confZone,30,true);
      document.getElementById('chgLogin').style.display='none';
      document.getElementById('chgDoneTitle').textContent='Welcome Back!';
      document.getElementById('chgDoneMsg').textContent='You\'re logged in. We\'ll track your favorites.';
      document.getElementById('chgDone').style.display='';
      setTimeout(function(){if(popup){popup.remove();popup=null}},2500);
    };
  }

  // Auto-track listing clicks with price and city data
  document.addEventListener('click',function(e){
    var link=e.target.closest('a[href*="property.html"],.listing-card,.listing-prev-card,.result-card');
    if(link){
      var m=(link.getAttribute('href')||'').match(/id=(\d+)/);
      var id=m?m[1]:'unknown';
      // Try to extract price and city from the card's DOM
      var price=0, city='';
      var priceEl=link.querySelector('.listing-card-price,.listing-prev-price,.result-card-price,.listing-popup-price');
      if(priceEl){
        var pt=priceEl.textContent.replace(/[^0-9.KMkm]/g,'');
        if(pt.match(/[Mm]/))price=parseFloat(pt)*1000000;
        else if(pt.match(/[Kk]/))price=parseFloat(pt)*1000;
        else price=parseFloat(pt)||0;
      }
      var addrEl=link.querySelector('.listing-card-address,.listing-prev-addr,.result-card-address,.listing-popup-address');
      if(addrEl){
        var parts=addrEl.textContent.split(',');
        if(parts.length>=2) city=parts[parts.length-1].trim();
      }
      window.chgTrackListingClick(id,price,city);
    }
  });

  checkThreshold();
})();
