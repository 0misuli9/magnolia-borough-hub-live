const BOROUGH_CONFIG={
  name:'Borough of Magnolia',
  county:'Camden County',
  state:'New Jersey',
  established:'1915',
  phone:'(856) 783-1520',
  hallAddress:'Borough Hall address to be confirmed by borough staff',
  hours:'Office hours to be confirmed by borough staff',
  serviceCategories:[
    'Roads & Infrastructure',
    'Utilities & Lighting',
    'Parks & Public Spaces',
    'Sanitation & Trash',
    'Noise & Safety',
    'Permits & Zoning',
    'Other'
  ],
  triage:{
    // Tunable per municipality. Higher category weights rise faster in the staff urgency queue.
    categoryUrgency:{
      'Roads & Infrastructure':80,
      'Utilities & Lighting':85,
      'Parks & Public Spaces':35,
      'Sanitation & Trash':50,
      'Noise & Safety':90,
      'Permits & Zoning':25,
      'Other':30
    },
    // Target first-action windows by computed urgency tier.
    slaTargetDays:{high:2,medium:5,low:10},
    // Server uses these score cutoffs to label High, Medium, and Low triage.
    triageThresholds:{high:60,medium:30},
    // Staff-facing age badges.
    agingThresholds:{newMaxDays:2,agingMaxDays:5,overdueMinDays:6}
  },
  departments:[
    {name:'Borough Hall',phone:'(856) 783-1520',email:'Email to be confirmed',hours:'Hours to be confirmed',notes:'General borough questions and routing.'},
    {name:'Borough Clerk',phone:'(856) 783-1520',email:'Email to be confirmed',hours:'Hours to be confirmed',notes:'Records, meetings, licenses, and general municipal administration.'},
    {name:'Public Works',phone:'(856) 784-6162',email:'Email to be confirmed',hours:'Hours to be confirmed',notes:'Roads, potholes, street issues, trash, recycling, and public works concerns.'},
    {name:'Tax Collector',phone:'(856) 783-1520',email:'Email to be confirmed',hours:'Hours to be confirmed',notes:'Tax questions and payment routing.'},
    {name:'Construction / Permits',phone:'(856) 783-1520',email:'Email to be confirmed',hours:'Hours to be confirmed',notes:'Permits, inspections, and construction-office routing.'},
    {name:'Police Non-Emergency',phone:'Contact Borough Hall for current non-emergency routing',email:'Not applicable',hours:'For emergencies call 911',notes:'Use 911 for emergencies. Confirm non-emergency routing with the borough.'}
  ],
  calendarItems:[
    {title:'Council Meetings',detail:'Meeting schedule and agenda links should be confirmed by borough staff.',status:'Needs borough confirmation'},
    {title:'Trash & Recycling',detail:'Collection days should be confirmed from the borough schedule before broad public use.',status:'Needs borough confirmation'},
    {title:'Public Notices & Events',detail:'Active event announcements posted by staff appear in the Announcements section.',status:'Live through announcements'}
  ],
  forms:[
    {title:'Public Records Request (OPRA)',detail:'Public-records request path and final wording should be confirmed by the borough.',status:'Contact Borough Hall'},
    {title:'Permit Forms',detail:'Construction and zoning form links can be added after borough staff confirms the official source.',status:'Link pending'},
    {title:'Resident Service Request',detail:'Use the Report a Problem card to submit non-emergency service requests through this portal.',status:'Available in portal'}
  ]
};
window.isStaffAuthenticated=false;
let staffSession=null;
let staffProfile=null;
let supabaseClient=null;
let supabaseConfigPromise=null;
let currentStaffView='resident';
let staffLoginMode='password';
let pendingMfaChallenge=null;
let announcements=[];
let requests=[];
let dashboardSnapshot=null;
let staffRefreshTimer=null;
let convHistory=[];
let lastResponseId=null;
let isLoading=false;
let pendingPhotoUploads=[];
let activeDrawerTrackingNumber=null;
let activeDrawerRequest=null;
let drawerReturnFocus=null;
let loginReturnFocus=null;

function normalizeUiStatus(status){
  var value=String(status||'open').toLowerCase().replace(/-/g,'_');
  if(value==='pending')return 'open';
  if(value==='progress')return 'in_progress';
  return ['open','in_progress','resolved','closed'].includes(value)?value:'open';
}
function statusLabel(status){
  var value=normalizeUiStatus(status);
  if(value==='in_progress')return 'In Progress';
  return value.charAt(0).toUpperCase()+value.slice(1);
}
function statusExplanation(status){
  var value=normalizeUiStatus(status);
  if(value==='in_progress')return 'Staff has started working on this request.';
  if(value==='resolved')return 'Marked complete by staff.';
  if(value==='closed')return 'Closed in the borough system.';
  return 'Received and waiting for review.';
}
function statusTimelineHtml(status){
  var value=normalizeUiStatus(status);
  var stages=[
    {key:'open',label:'Submitted'},
    {key:'review',label:'Under Review'},
    {key:'in_progress',label:'In Progress'},
    {key:'resolved',label:'Resolved'}
  ];
  if(value==='closed'){
    stages.push({key:'closed',label:'Closed'});
  }
  var activeIndex=value==='closed'?4:value==='resolved'?3:value==='in_progress'?2:1;
  return '<div class="status-timeline" aria-label="Request status timeline">'+stages.map(function(stage,index){
    var state=index<activeIndex?'complete':index===activeIndex?'active':'';
    return '<div class="timeline-step '+state+'">'+escapeHtml(stage.label)+'</div>';
  }).join('')+'</div>';
}
function renderAnnouncements(){
  const list=document.getElementById('annList');
  if(!announcements.length){list.innerHTML='<div class="empty-state"><div class="icon">📋</div><p>No announcements yet.</p></div>';return;}
  list.innerHTML=announcements.map(a=>`<div class="announcement-card ${a.type}"><div class="ann-meta"><span class="ann-tag tag-${a.type}">${a.type==='urgent'?'🚨 Urgent':a.type==='event'?'📅 Event':'ℹ️ Info'}</span><span class="ann-date">${a.date}</span></div><div class="ann-title">${a.title}</div><div class="ann-body">${a.body}</div></div>`).join('');
}
function triageClass(level){
  var value=String(level||'Low').toLowerCase();
  return value==='high'?'triage-high':value==='medium'?'triage-medium':'triage-low';
}
function triageBadgeHtml(triage){
  if(!triage)return '';
  var level=escapeHtml(triage.level||'Low');
  var score=Number.isFinite(Number(triage.score))?Number(triage.score):0;
  var badges=Array.isArray(triage.badges)?triage.badges:[];
  var chips=badges.map(function(badge){return '<span class="triage-chip">'+escapeHtml(badge)+'</span>';}).join('');
  return '<div class="triage-row"><span class="triage-badge '+triageClass(triage.level)+'">'+level+' triage · '+score+'</span>'+chips+'</div>';
}
function triageSummaryHtml(triage){
  if(!triage||!Array.isArray(triage.factors)||!triage.factors.length)return '';
  return '<div class="triage-summary">'+triage.factors.map(escapeHtml).join(' · ')+'</div>';
}
function preventDefaultIfEvent(e){
  if(e&&typeof e.preventDefault==='function')e.preventDefault();
}
function renderRequests(){
  const open=requests.filter(r=>r.status==='open').length;
  const prog=requests.filter(r=>normalizeUiStatus(r.status)==='in_progress').length;
  const res=requests.filter(r=>r.status==='resolved').length;
  document.getElementById('statOpen').textContent=open;
  document.getElementById('statProgress').textContent=prog;
  document.getElementById('statResolved').textContent=res;
  document.getElementById('openCount').textContent=open+prog;
  const list=document.getElementById('reqList');
  if(!requests.length){list.innerHTML='<div class="empty-state"><div class="icon">🎫</div><p>No service requests yet.</p></div>';return;}
  list.innerHTML='<div class="requests-grid">'+requests.map(function(r){
    var triage=window.isStaffAuthenticated?triageBadgeHtml(r.triage)+triageSummaryHtml(r.triage):'';
    var controls=window.isStaffAuthenticated?`<div class="request-actions"><button type="button" data-request-detail="${r.id}">Details</button><button type="button" data-request-id="${r.id}" data-request-update="open">Open</button><button type="button" data-request-id="${r.id}" data-request-update="in_progress">In Progress</button><button type="button" data-request-id="${r.id}" data-request-update="resolved">Resolve</button></div>`:'';
    var cardAttrs=window.isStaffAuthenticated?` tabindex="0" role="button" aria-label="Open request ${r.id} detail"`:'';
    return `<div class="request-card" data-request-card="${r.id}"${cardAttrs}><div class="req-top"><span class="req-id">${r.id}</span><span class="req-status status-${normalizeUiStatus(r.status)}">${statusLabel(r.status)}</span></div><div class="req-title">${r.title}</div><div class="req-desc">${r.desc}</div>${triage}<div class="req-footer"><span class="req-cat">${r.cat}</span><span class="req-date">${r.date}</span></div>${controls}</div>`;
  }).join('')+'</div>';
}
async function lookupTicket(e){
  preventDefaultIfEvent(e);
  const input=document.getElementById('lookupInput').value.trim().toUpperCase();
  const result=document.getElementById('lookupResult');
  if(!input){result.style.display='none';return;}
  const id=input.startsWith('MGN-')?input:'MGN-'+input;
  result.style.display='block';
  result.className='lookup-result found';
  result.innerHTML='Checking '+escapeHtml(id)+'...';
  try{
    var res=await fetch('/api/requests?tracking_number='+encodeURIComponent(id));
    var data=await res.json();
    if(!res.ok||!data.request){
      throw new Error(data&&data.error?data.error:'Request not found.');
    }
    autoAddRequest(data.request);
    var ticket=normalizeCreatedRequestRecord(data.request);
    const s=statusLabel(ticket.status);
    var updated=data.request.updated_at?formatRequestDate(data.request.updated_at):'Not available';
    result.className='lookup-result found';
    result.innerHTML='<div class="lookup-result-title">Request '+ticket.id+'</div>'+
      '<strong>Issue:</strong> '+ticket.title+'<br/>'+
      '<strong>Status:</strong> '+escapeHtml(s)+' - '+escapeHtml(statusExplanation(ticket.status))+'<br/>'+
      '<strong>Category:</strong> '+ticket.cat+'<br/>'+
      '<strong>Submitted:</strong> '+ticket.date+'<br/>'+
      '<strong>Last updated:</strong> '+escapeHtml(updated)+
      statusTimelineHtml(ticket.status);
  }catch(err){
    result.className='lookup-result notfound';
    result.innerHTML='No request found for <strong>'+escapeHtml(id)+'</strong>. Please check your number or call Borough Hall at (856) 783-1520.';
  }
}
document.getElementById('lookupInput').addEventListener('keydown',function(e){if(e.key==='Enter')lookupTicket(e);});
document.getElementById('requestSearch').addEventListener('keydown',function(e){if(e.key==='Enter')loadStaffRequests();});
function switchTab(name,el){
  if(window.isStaffAuthenticated&&currentStaffView==='dashboard'){
    currentStaffView='resident';
    applyStaffViewMode();
  }
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
  el.classList.add('active');
  document.getElementById(name).classList.add('active');
  if(window.isStaffAuthenticated&&name==='requests'){
    loadStaffRequests().catch(function(err){console.warn('Request load failed:',err.message||err);});
  }
  if(name==='announcements'){
    loadAnnouncements(window.isStaffAuthenticated).catch(function(err){console.warn('Announcement load failed:',err.message||err);});
  }
}
function getTabButton(name){
  var panelIds=['chat','announcements','requests'];
  var index=panelIds.indexOf(name);
  return index>=0?document.querySelectorAll('.tab')[index]:null;
}
function switchTabByName(name){
  var tab=getTabButton(name);
  if(tab){
    switchTab(name,tab);
  }
}
function switchResidentPanel(name){
  if(window.isStaffAuthenticated&&currentStaffView==='dashboard'){
    currentStaffView='resident';
    applyStaffViewMode();
  }
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
  var panel=document.getElementById(name);
  if(panel){
    panel.classList.add('active');
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
}
function focusAssistant(){
  switchTabByName('chat');
  scrollToChat();
}
function focusRequestLookup(){
  switchTabByName('requests');
  setTimeout(function(){
    var input=document.getElementById('lookupInput');
    if(input)input.focus();
  },100);
}
function focusAnnouncements(){
  switchTabByName('announcements');
  setTimeout(function(){
    var title=document.querySelector('#announcements .section-title');
    if(title)title.scrollIntoView({behavior:'smooth',block:'start'});
  },50);
}
function startProblemReport(){
  switchResidentPanel('report');
  setTimeout(function(){
    var input=document.getElementById('publicReqCategory');
    if(input)input.focus();
  },100);
}
function handleResidentAction(action){
  if(action==='start-here'){
    var cards=document.querySelector('.task-grid');
    if(cards)cards.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  if(action==='ask-question'){
    focusAssistant();
    return;
  }
  if(action==='report-problem'){
    startProblemReport();
    return;
  }
  if(action==='check-request'){
    focusRequestLookup();
    return;
  }
  if(action==='see-updates'){
    focusAnnouncements();
    return;
  }
  if(action==='departments'){
    switchResidentPanel('contacts');
    return;
  }
  if(action==='calendar'){
    switchResidentPanel('calendar');
    return;
  }
  if(action==='forms'){
    switchResidentPanel('forms');
  }
}
function scrollToChat(){document.getElementById('chatContainer').scrollIntoView({behavior:'smooth'});setTimeout(function(){document.getElementById('chatInput').focus();},400);}
async function getSupabaseClient(){
  if(supabaseClient)return supabaseClient;
  if(!window.supabase||!window.supabase.createClient){
    throw new Error('Supabase client library failed to load.');
  }
  if(!supabaseConfigPromise){
    supabaseConfigPromise=fetch('/api/auth-config')
      .then(function(res){return res.json().then(function(data){return {ok:res.ok,data:data};});})
      .then(function(result){
        if(!result.ok||!result.data||!result.data.success){
          throw new Error(result.data&&result.data.message?result.data.message:'Supabase auth configuration failed to load.');
        }
        return result.data;
      });
  }
  var config=await supabaseConfigPromise;
  supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  return supabaseClient;
}
async function verifyStaffSession(session){
  if(!session||!session.access_token){
    return null;
  }
  var res=await fetch('/api/staff-session',{
    headers:{Authorization:'Bearer '+session.access_token}
  });
  var data=await res.json();
  if(!res.ok||!data.authenticated){
    throw new Error(data&&data.message?data.message:'This account is not authorized for staff access.');
  }
  return data.staff||null;
}
async function getStaffAccessToken(){
  var client=await getSupabaseClient();
  var result=await client.auth.getSession();
  if(result.error)throw result.error;
  if(!result.data.session){
    setStaffSession(null,null);
    throw new Error('Staff session expired. Please sign in again.');
  }
  staffSession=result.data.session;
  return result.data.session.access_token;
}
function setStaffSession(session,profile){
  staffSession=session||null;
  staffProfile=profile||null;
  window.isStaffAuthenticated=Boolean(staffSession&&staffProfile);
  updateStaffUi();
  if(window.isStaffAuthenticated){
    refreshStaffData().catch(function(err){console.warn('Staff data refresh failed:',err.message||err);});
    startStaffPolling();
  }else{
    if(staffRefreshTimer){
      clearInterval(staffRefreshTimer);
      staffRefreshTimer=null;
    }
    requests=[];
    dashboardSnapshot=null;
    renderRequests();
    loadAnnouncements(false).catch(function(err){console.warn('Public announcement reload failed:',err.message||err);});
  }
}
function updateStaffUi(){
  var btn=document.getElementById('adminToggle');
  var isStaff=window.isStaffAuthenticated;
  btn.textContent=isStaff?'Sign Out':'Staff Login';
  btn.classList.toggle('active',isStaff);
  document.getElementById('adminPostForm').style.display=isStaff?'block':'none';
  document.getElementById('adminRequestPanel').style.display=isStaff?'block':'none';
  document.getElementById('staffRequestFilters').style.display=isStaff?'grid':'none';
  document.getElementById('staffViewToggle').style.display=isStaff?'block':'none';
  if(!isStaff){
    currentStaffView='resident';
  }
  applyStaffViewMode();
}
function updateStaffViewButtons(){
  document.getElementById('residentViewBtn').classList.toggle('active',currentStaffView==='resident');
  document.getElementById('staffDashboardBtn').classList.toggle('active',currentStaffView==='dashboard');
}
function applyStaffViewMode(){
  var showDashboard=window.isStaffAuthenticated&&currentStaffView==='dashboard';
  document.querySelector('.main').style.display=showDashboard?'none':'block';
  document.getElementById('admin-dashboard').style.display=showDashboard?'block':'none';
  if(showDashboard){
    document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  }else{
    var activePanel=document.querySelector('.panel.active');
    var panelIds=['chat','announcements','requests'];
    var index=activePanel?panelIds.indexOf(activePanel.id):-1;
    if(index>=0&&!document.querySelector('.tab.active')){
      document.querySelectorAll('.tab')[index].classList.add('active');
    }
  }
  updateStaffViewButtons();
}
function showResidentView(){
  currentStaffView='resident';
  applyStaffViewMode();
}
function showStaffDashboard(){
  if(!window.isStaffAuthenticated){
    showLoginModal();
    return;
  }
  currentStaffView='dashboard';
  applyStaffViewMode();
  refreshStaffData().catch(function(err){console.warn('Dashboard refresh failed:',err.message||err);});
}
function setStaffLoginMode(mode){
  staffLoginMode=mode;
  document.getElementById('staffPasswordPanel').style.display=mode==='password'?'block':'none';
  document.getElementById('staffMfaPanel').style.display=mode==='mfa'?'block':'none';
  document.getElementById('staffPasswordRecoveryPanel').style.display=mode==='recovery'?'block':'none';
  document.getElementById('passwordResetBtn').style.display=mode==='password'?'inline-block':'none';
  document.getElementById('loginSubmit').textContent=mode==='mfa'?'Verify':mode==='recovery'?'Update Password':'Login';
}
function resetStaffLoginForm(){
  pendingMfaChallenge=null;
  document.getElementById('loginError').textContent='';
  document.getElementById('staffPassword').value='';
  document.getElementById('staffMfaCode').value='';
  document.getElementById('staffNewPassword').value='';
  document.getElementById('staffConfirmPassword').value='';
  setStaffLoginMode('password');
}
function showLoginModal(){
  loginReturnFocus=document.activeElement;
  resetStaffLoginForm();
  var modal=document.getElementById('login-modal');
  modal.style.display='flex';
  modal.setAttribute('aria-hidden','false');
  setTimeout(function(){document.getElementById('staffEmail').focus();},50);
}
function hideLoginModal(){
  var modal=document.getElementById('login-modal');
  modal.style.display='none';
  modal.setAttribute('aria-hidden','true');
  resetStaffLoginForm();
  if(loginReturnFocus&&typeof loginReturnFocus.focus==='function'){
    loginReturnFocus.focus();
  }
  loginReturnFocus=null;
}
async function toggleAdmin(){
  if(window.isStaffAuthenticated){
    try{
      var client=await getSupabaseClient();
      await client.auth.signOut();
    }catch(err){
      console.error('Staff sign-out error:',err);
    }
    setStaffSession(null,null);
    showToast('Signed out');
    return;
  }
  showLoginModal();
}
async function handleStaffLogin(){
  var email=document.getElementById('staffEmail').value.trim();
  var password=document.getElementById('staffPassword').value;
  var errorBox=document.getElementById('loginError');
  var submit=document.getElementById('loginSubmit');
  errorBox.textContent='';
  if(!email||!password){errorBox.textContent='Enter your staff email and password.';return;}
  submit.disabled=true;
  try{
    var client=await getSupabaseClient();
    var result=await client.auth.signInWithPassword({email:email,password:password});
    if(result.error)throw result.error;
    if(await beginStaffMfaIfNeeded(client)){
      submit.disabled=false;
      return;
    }
    var profile=await verifyStaffSession(result.data.session);
    setStaffSession(result.data.session,profile);
    hideLoginModal();
    showToast('Signed in');
  }catch(err){
    try{
      var clientForSignOut=await getSupabaseClient();
      await clientForSignOut.auth.signOut();
    }catch(_signOutError){}
    setStaffSession(null,null);
    errorBox.textContent=err&&err.message?err.message:'Unable to sign in.';
  }
  submit.disabled=false;
}
async function beginStaffMfaIfNeeded(client){
  var aalResult=await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aalResult.error)throw aalResult.error;
  var aal=aalResult.data||{};
  if(aal.nextLevel!=='aal2'||aal.currentLevel==='aal2'){
    return false;
  }

  var factorsResult=await client.auth.mfa.listFactors();
  if(factorsResult.error)throw factorsResult.error;
  var factors=factorsResult.data||{};
  var verifiedTotp=(factors.totp||[]).find(function(factor){return factor.status==='verified';});
  if(!verifiedTotp){
    throw new Error('MFA is required. Enroll a verified authenticator factor for this staff user in Supabase.');
  }

  var challengeResult=await client.auth.mfa.challenge({factorId:verifiedTotp.id});
  if(challengeResult.error)throw challengeResult.error;
  pendingMfaChallenge={
    factorId:verifiedTotp.id,
    challengeId:challengeResult.data.id
  };
  setStaffLoginMode('mfa');
  document.getElementById('loginError').textContent='Enter the code from the staff authenticator app.';
  setTimeout(function(){document.getElementById('staffMfaCode').focus();},50);
  return true;
}
async function handleStaffMfaVerify(){
  var code=document.getElementById('staffMfaCode').value.trim();
  var errorBox=document.getElementById('loginError');
  var submit=document.getElementById('loginSubmit');
  errorBox.textContent='';
  if(!pendingMfaChallenge||!code){errorBox.textContent='Enter the authenticator code.';return;}
  submit.disabled=true;
  try{
    var client=await getSupabaseClient();
    var verifyResult=await client.auth.mfa.verify({
      factorId:pendingMfaChallenge.factorId,
      challengeId:pendingMfaChallenge.challengeId,
      code:code
    });
    if(verifyResult.error)throw verifyResult.error;
    var sessionResult=await client.auth.getSession();
    if(sessionResult.error)throw sessionResult.error;
    var profile=await verifyStaffSession(sessionResult.data.session);
    setStaffSession(sessionResult.data.session,profile);
    hideLoginModal();
    showToast('Signed in');
  }catch(err){
    errorBox.textContent=err&&err.message?err.message:'Unable to verify MFA code.';
  }
  submit.disabled=false;
}
async function sendStaffPasswordReset(){
  var email=document.getElementById('staffEmail').value.trim();
  var errorBox=document.getElementById('loginError');
  errorBox.textContent='';
  if(!email){errorBox.textContent='Enter your staff email first.';return;}
  try{
    var client=await getSupabaseClient();
    var result=await client.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
    if(result.error)throw result.error;
    errorBox.textContent='Password reset email sent.';
  }catch(err){
    errorBox.textContent=err&&err.message?err.message:'Unable to send reset email.';
  }
}
function showPasswordRecoveryMode(){
  loginReturnFocus=document.activeElement;
  document.getElementById('loginError').textContent='Enter a new staff password.';
  var modal=document.getElementById('login-modal');
  modal.style.display='flex';
  modal.setAttribute('aria-hidden','false');
  setStaffLoginMode('recovery');
  setTimeout(function(){document.getElementById('staffNewPassword').focus();},50);
}
async function handleStaffPasswordUpdate(){
  var password=document.getElementById('staffNewPassword').value;
  var confirmPassword=document.getElementById('staffConfirmPassword').value;
  var errorBox=document.getElementById('loginError');
  var submit=document.getElementById('loginSubmit');
  errorBox.textContent='';
  if(password.length<8){errorBox.textContent='Use at least 8 characters.';return;}
  if(password!==confirmPassword){errorBox.textContent='Passwords do not match.';return;}
  submit.disabled=true;
  try{
    var client=await getSupabaseClient();
    var result=await client.auth.updateUser({password:password});
    if(result.error)throw result.error;
    var sessionResult=await client.auth.getSession();
    if(sessionResult.error)throw sessionResult.error;
    var profile=await verifyStaffSession(sessionResult.data.session);
    setStaffSession(sessionResult.data.session,profile);
    hideLoginModal();
    showToast('Password updated');
  }catch(err){
    errorBox.textContent=err&&err.message?err.message:'Unable to update password.';
  }
  submit.disabled=false;
}
function handleLoginPrimaryAction(){
  if(staffLoginMode==='mfa'){
    handleStaffMfaVerify();
    return;
  }
  if(staffLoginMode==='recovery'){
    handleStaffPasswordUpdate();
    return;
  }
  handleStaffLogin();
}
async function initStaffAuth(){
  try{
    var client=await getSupabaseClient();
    var result=await client.auth.getSession();
    if(result.error)throw result.error;
    if(result.data.session){
      try{
        var profile=await verifyStaffSession(result.data.session);
        setStaffSession(result.data.session,profile);
      }catch(_staffError){
        setStaffSession(null,null);
      }
    }else{
      setStaffSession(null,null);
    }
    client.auth.onAuthStateChange(async function(event,session){
      if(event==='PASSWORD_RECOVERY'){
        setStaffSession(null,null);
        showPasswordRecoveryMode();
        return;
      }
      if(!session){
        setStaffSession(null,null);
        return;
      }
      try{
        var profile=await verifyStaffSession(session);
        setStaffSession(session,profile);
      }catch(err){
        console.warn('Staff role check failed:',err.message||err);
        setStaffSession(null,null);
      }
    });
  }catch(err){
    setStaffSession(null,null);
    console.warn('Staff auth unavailable:',err.message||err);
  }
}
function setMetric(id,value){
  document.getElementById(id).textContent=value;
}
function formatAuditTime(value){
  if(!value)return '';
  var parsed=new Date(value);
  if(Number.isNaN(parsed.getTime()))return String(value);
  return parsed.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function getTopTopic(requestRows){
  var counts={};
  (requestRows||[]).forEach(function(row){
    var category=String(row.category||'Uncategorized').trim()||'Uncategorized';
    counts[category]=(counts[category]||0)+1;
  });
  var top=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];})[0];
  return top?top:'-';
}
const AUDIT_EVENT_LABELS={
  request_created:'Request created',
  request_created_from_chat:'Request created (chat)',
  request_updated:'Request updated',
  request_status_changed:'Request status changed',
  request_priority_changed:'Request priority changed',
  request_assigned:'Request assigned',
  internal_note_updated:'Internal note updated',
  request_photo_attached:'Photo attached',
  announcement_created:'Announcement posted',
  announcement_updated:'Announcement updated',
  announcement_archived:'Announcement archived',
  knowledge_created:'Knowledge added',
  knowledge_updated:'Knowledge updated',
  knowledge_archived:'Knowledge archived',
  staff_sign_in:'Staff sign-in'
};
function humanizeAuditEvent(eventType){
  return AUDIT_EVENT_LABELS[eventType]||String(eventType||'Activity').replace(/_/g,' ').replace(/\b\w/g,function(char){return char.toUpperCase();});
}
function formatAuditRecord(row){
  var eventType=String(row.event_type||'');
  var record=String(row.related_record_id||'').trim();
  if(/^MGN-(?:\d{4}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8})$/i.test(record))return record.toUpperCase();
  if(eventType.indexOf('announcement_')===0)return 'Announcement';
  if(eventType.indexOf('knowledge_')===0)return 'Knowledge base';
  if(eventType==='staff_sign_in')return 'Staff account';
  if(eventType.indexOf('chat')>=0)return 'Conversation';
  return '—';
}
function formatAuditValue(value){
  if(Array.isArray(value))return value.join(', ');
  if(typeof value==='boolean')return value?'Yes':'No';
  if(value===null||typeof value==='undefined'||value==='')return '';
  return String(value);
}
function auditMetadataItems(row){
  var metadata=row&&row.metadata&&typeof row.metadata==='object'?row.metadata:{};
  var items=[];
  var allowed=[
    ['source','Source'],
    ['category','Category'],
    ['status','Status'],
    ['from','From'],
    ['to','To'],
    ['photoCount','Photos'],
    ['type','Type'],
    ['changedFields','Changed'],
    ['hasAddress','Address provided']
  ];
  allowed.forEach(function(pair){
    var value=formatAuditValue(metadata[pair[0]]);
    if(value)items.push({label:pair[1],value:value});
  });
  return items;
}
function renderAuditLogRows(rows){
  var table=document.getElementById('auditLogRows');
  var visibleRows=(rows||[]).filter(function(row){return Boolean(AUDIT_EVENT_LABELS[row.event_type]);});
  if(!visibleRows.length){
    table.innerHTML='<tr><td colspan="4">No recent audit activity.</td></tr>';
    return;
  }
  table.innerHTML=visibleRows.map(function(row){
    var items=auditMetadataItems(row);
    var metadata=items.length?items.map(function(item){
      return '<span class="audit-chip">'+escapeHtml(item.label)+': '+escapeHtml(item.value)+'</span>';
    }).join(''):'<span class="audit-muted">No public-facing details</span>';
    return '<tr>'+
      '<td>'+escapeHtml(formatAuditTime(row.timestamp))+'</td>'+
      '<td>'+escapeHtml(humanizeAuditEvent(row.event_type))+'</td>'+
      '<td>'+escapeHtml(formatAuditRecord(row))+'</td>'+
      '<td>'+metadata+'</td>'+
    '</tr>';
  }).join('');
}
function renderDashboardList(id,rows,kind){
  var target=document.getElementById(id);
  if(!target)return;
  if(!rows||!rows.length){
    target.textContent=kind==='announcement'?'No active announcements.':'No recent requests.';
    return;
  }
  target.innerHTML=rows.map(function(row){
    if(kind==='announcement'){
      return '<div class="dashboard-list-item"><div class="dashboard-list-title">'+escapeHtml(row.title||'Untitled announcement')+'</div><div class="dashboard-list-meta">'+escapeHtml(row.status||'active')+' - '+escapeHtml(formatAnnouncementDate(row.created_at))+'</div></div>';
    }
    return '<div class="dashboard-list-item"><div class="dashboard-list-title">'+escapeHtml(row.tracking_number||row.id||'Request')+' - '+escapeHtml(row.title||'Untitled request')+'</div><div class="dashboard-list-meta">'+escapeHtml(statusLabel(row.status))+' - '+escapeHtml(row.category||'Other')+' - '+escapeHtml(formatRequestDate(row.created_at))+'</div></div>';
  }).join('');
}
async function refreshStaffData(){
  if(!window.isStaffAuthenticated)return;
  var token=await getStaffAccessToken();
  await Promise.all([
    loadStaffRequests(token),
    loadAnnouncements(true,token)
  ]);
  if(currentStaffView==='dashboard'){
    await fetchAdminMetrics(token);
  }
}
function startStaffPolling(){
  if(staffRefreshTimer)return;
  staffRefreshTimer=setInterval(function(){
    if(window.isStaffAuthenticated){
      refreshStaffData().catch(function(err){console.warn('Staff polling failed:',err.message||err);});
    }
  },30000);
}
async function fetchAdminMetrics(){
  if(!window.isStaffAuthenticated){
    document.getElementById('auditStatus').textContent='Staff login required.';
    return;
  }
  document.getElementById('auditStatus').textContent='Loading...';
  try{
    var token=arguments[0]||await getStaffAccessToken();
    var res=await fetch('/api/dashboard',{
      headers:{Authorization:'Bearer '+token}
    });
    var data=await res.json();
    if(res.status===401||res.status===403){
      setStaffSession(null,null);
      document.getElementById('auditStatus').textContent='Staff session expired.';
      return;
    }
    if(!res.ok||!data.success){
      throw new Error(data&&data.message?data.message:'Unable to load dashboard.');
    }
    dashboardSnapshot=data;
    var metrics=data.metrics||{};
    var auditRows=data.latest_audit_logs||[];
    setMetric('metricConversations',metrics.conversations||0);
    setMetric('metricOpenRequests',metrics.open_requests||0);
    setMetric('metricInProgressRequests',metrics.in_progress_requests||0);
    setMetric('metricResolvedRequests',metrics.resolved_requests||0);
    setMetric('metricNeedsAttention',metrics.needs_attention||0);
    setMetric('metricTopTopics',metrics.top_category||'-');
    setMetric('metricRecentActivity',metrics.recent_activity||0);
    renderDashboardList('dashboardLatestRequests',data.latest_requests||[],'request');
    renderDashboardList('dashboardLatestAnnouncements',data.latest_announcements||[],'announcement');
    renderAuditLogRows(auditRows);
    document.getElementById('auditStatus').textContent='Last refreshed '+formatAuditTime(data.generated_at)+'.';
  }catch(err){
    console.error('Admin metrics error:',err);
    document.getElementById('auditStatus').textContent=err&&err.message?err.message:'Unable to load dashboard.';
    setMetric('metricConversations','-');
    setMetric('metricOpenRequests','-');
    setMetric('metricInProgressRequests','-');
    setMetric('metricResolvedRequests','-');
    setMetric('metricNeedsAttention','-');
    setMetric('metricTopTopics','-');
    setMetric('metricRecentActivity','-');
    renderDashboardList('dashboardLatestRequests',[],'request');
    renderDashboardList('dashboardLatestAnnouncements',[],'announcement');
    renderAuditLogRows([]);
  }
}
function formatAnnouncementDate(value){
  if(!value)return new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  var parsed=new Date(value);
  if(Number.isNaN(parsed.getTime()))return String(value);
  return parsed.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
}
function normalizeAnnouncementRecord(record){
  if(!record)return null;
  return {
    id:record.id||Date.now(),
    type:['urgent','event','info'].includes(String(record.type))?String(record.type):'info',
    title:escapeHtml(record.title||'Untitled announcement'),
    body:escapeHtml(record.body||''),
    date:escapeHtml(formatAnnouncementDate(record.created_at||record.date))
  };
}
function populatePublicRequestCategories(){
  var select=document.getElementById('publicReqCategory');
  if(!select)return;
  select.innerHTML=BOROUGH_CONFIG.serviceCategories.map(function(category){
    return '<option value="'+escapeHtml(category)+'">'+escapeHtml(category)+'</option>';
  }).join('');
}
function renderDepartments(){
  var target=document.getElementById('departmentDirectory');
  if(!target)return;
  target.innerHTML=BOROUGH_CONFIG.departments.map(function(department){
    return '<article class="content-card">'+
      '<h3>'+escapeHtml(department.name)+'</h3>'+
      '<div class="content-meta">'+
      '<span><strong>Phone:</strong> '+escapeHtml(department.phone)+'</span>'+
      '<span><strong>Email:</strong> '+escapeHtml(department.email)+'</span>'+
      '<span><strong>Hours:</strong> '+escapeHtml(department.hours)+'</span>'+
      '<span><strong>Use for:</strong> '+escapeHtml(department.notes)+'</span>'+
      '</div>'+
    '</article>';
  }).join('');
}
function renderCalendar(){
  var target=document.getElementById('calendarList');
  var note=document.getElementById('calendarEventNote');
  if(!target)return;
  var eventAnnouncements=announcements.filter(function(item){return item.type==='event';});
  var cards=BOROUGH_CONFIG.calendarItems.map(function(item){
    return '<article class="content-card">'+
      '<h3>'+escapeHtml(item.title)+'</h3>'+
      '<p>'+escapeHtml(item.detail)+'</p>'+
      '<p><strong>Status:</strong> '+escapeHtml(item.status)+'</p>'+
    '</article>';
  });
  eventAnnouncements.forEach(function(event){
    cards.push('<article class="content-card">'+
      '<h3>'+event.title+'</h3>'+
      '<p>'+event.body+'</p>'+
      '<p><strong>Posted:</strong> '+event.date+'</p>'+
    '</article>');
  });
  target.innerHTML=cards.join('');
  if(note)note.style.display=eventAnnouncements.length?'none':'block';
}
function renderForms(){
  var target=document.getElementById('formsList');
  if(!target)return;
  target.innerHTML=BOROUGH_CONFIG.forms.map(function(form){
    return '<article class="content-card">'+
      '<h3>'+escapeHtml(form.title)+'</h3>'+
      '<p>'+escapeHtml(form.detail)+'</p>'+
      '<p><strong>Status:</strong> '+escapeHtml(form.status)+'</p>'+
    '</article>';
  }).join('');
}
function populateResidentDepth(){
  populatePublicRequestCategories();
  renderDepartments();
  renderCalendar();
  renderForms();
}
async function loadAnnouncements(staffMode,existingToken){
  try{
    var headers={};
    var url='/api/announcements';
    if(staffMode&&window.isStaffAuthenticated){
      url+='?staff=1';
      headers.Authorization='Bearer '+(existingToken||await getStaffAccessToken());
    }
    var res=await fetch(url,{headers:headers});
    var data=await res.json();
    if((res.status===401||res.status===403)&&staffMode){
      setStaffSession(null,null);
    }
    if(!res.ok){
      throw new Error(data&&data.error?data.error:'Failed to load announcements.');
    }
    announcements=(data.announcements||[]).map(normalizeAnnouncementRecord).filter(Boolean);
    renderAnnouncements();
    renderCalendar();
  }catch(err){
    console.warn('Announcement load failed:',err.message||err);
    renderAnnouncements();
    renderCalendar();
  }
}
async function postAnnouncement(){
  var title=document.getElementById('annTitle').value.trim();
  var body=document.getElementById('annBody').value.trim();
  var type=document.getElementById('annType').value;
  if(!title||!body){alert('Please fill in title and message.');return;}
  try{
    var token=await getStaffAccessToken();
    var res=await fetch('/api/announcements',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify({type:type,title:title,body:body})
    });
    var data=await res.json();
    if(!res.ok){
      if(res.status===401||res.status===403)setStaffSession(null,null);
      throw new Error(data&&data.error?data.error:'Failed to post announcement.');
    }
    document.getElementById('annTitle').value='';
    document.getElementById('annBody').value='';
    await loadAnnouncements(true,token);
    if(currentStaffView==='dashboard')await fetchAdminMetrics(token);
    showToast('Announcement posted.');
  }catch(err){
    alert(err&&err.message?err.message:'Failed to post announcement.');
  }
}
async function addRequest(){
  var title=document.getElementById('reqTitle').value.trim();
  var desc=document.getElementById('reqDesc').value.trim();
  var cat=document.getElementById('reqCat').value;
  var status=document.getElementById('reqStatus').value;
  var addr=document.getElementById('reqAddr').value.trim();
  if(!title){alert('Please add a title.');return;}
  try{
    var token=await getStaffAccessToken();
    var res=await fetch('/api/requests',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify({title:title,description:desc,category:cat,status:status,address:addr})
    });
    var data=await res.json();
    if(!res.ok){
      if(res.status===401||res.status===403)setStaffSession(null,null);
      throw new Error(data&&data.error?data.error:'Failed to log request.');
    }
    var id=autoAddRequest(data.request);
    await loadStaffRequests(token);
    if(currentStaffView==='dashboard')await fetchAdminMetrics(token);
    document.getElementById('reqTitle').value='';
    document.getElementById('reqDesc').value='';
    document.getElementById('reqAddr').value='';
    showToast('Request '+id+' logged.');
  }catch(err){
    alert(err&&err.message?err.message:'Failed to log request.');
  }
}
function setPhotoError(message){
  var box=document.getElementById('photoUploadError');
  if(box)box.textContent=message||'';
}
function clearPublicRequestPhotoState(){
  pendingPhotoUploads=[];
  var input=document.getElementById('publicReqPhotos');
  if(input)input.value='';
  setPhotoError('');
  renderPhotoPreviews();
}
function renderPhotoPreviews(){
  var grid=document.getElementById('photoPreviewGrid');
  if(!grid)return;
  if(!pendingPhotoUploads.length){
    grid.innerHTML='';
    return;
  }
  grid.innerHTML=pendingPhotoUploads.map(function(photo,index){
    return '<div class="photo-preview">'+
      '<img src="'+photo.previewUrl+'" alt="Selected photo preview '+(index+1)+'"/>'+
      '<div class="photo-preview-name">'+escapeHtml(photo.name)+'</div>'+
      '<button class="photo-remove" type="button" data-remove-photo="'+index+'">Remove</button>'+
    '</div>';
  }).join('');
}
function canvasToDataUrl(canvas,quality){
  return new Promise(function(resolve,reject){
    canvas.toBlob(function(blob){
      if(!blob){
        reject(new Error('Unable to resize this photo.'));
        return;
      }
      var reader=new FileReader();
      reader.addEventListener('load',function(){resolve({blob:blob,dataUrl:String(reader.result||'')});});
      reader.addEventListener('error',function(){reject(new Error('Unable to read resized photo.'));});
      reader.readAsDataURL(blob);
    },'image/jpeg',quality);
  });
}
function resizeImageFile(file){
  return new Promise(function(resolve,reject){
    var allowed=['image/jpeg','image/png','image/webp'];
    if(!allowed.includes(file.type)){
      reject(new Error('Only JPEG, PNG, or WebP photos are accepted. SVG and other files are not accepted.'));
      return;
    }
    if(file.size>10*1024*1024){
      reject(new Error('One selected photo is too large. Please use photos under 10 MB before resizing.'));
      return;
    }
    var image=new Image();
    var objectUrl=URL.createObjectURL(file);
    image.addEventListener('load',async function(){
      try{
        var maxDimension=1600;
        var scale=Math.min(1,maxDimension/Math.max(image.width,image.height));
        var canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.width*scale));
        canvas.height=Math.max(1,Math.round(image.height*scale));
        var ctx=canvas.getContext('2d');
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        var quality=0.82;
        var output=await canvasToDataUrl(canvas,quality);
        while(output.blob.size>700*1024&&quality>0.58){
          quality-=0.08;
          output=await canvasToDataUrl(canvas,quality);
        }
        URL.revokeObjectURL(objectUrl);
        resolve({
          name:file.name,
          type:'image/jpeg',
          size:output.blob.size,
          dataUrl:output.dataUrl,
          previewUrl:output.dataUrl
        });
      }catch(err){
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    });
    image.addEventListener('error',function(){
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to read one selected photo.'));
    });
    image.src=objectUrl;
  });
}
async function handlePhotoSelection(event){
  var files=Array.from(event.target.files||[]);
  setPhotoError('');
  if(!files.length)return;
  if(pendingPhotoUploads.length+files.length>3){
    setPhotoError('Attach up to 3 photos per request.');
    event.target.value='';
    return;
  }
  try{
    for(const file of files){
      var resized=await resizeImageFile(file);
      pendingPhotoUploads.push(resized);
    }
    renderPhotoPreviews();
  }catch(err){
    setPhotoError(err&&err.message?err.message:'Unable to prepare selected photos.');
  }
  event.target.value='';
}
async function uploadRequestPhotos(request,photos){
  if(!photos.length)return {count:0};
  var res=await fetch('/api/request-photos',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      request_id:request.id,
      tracking_number:request.tracking_number,
      photos:photos.map(function(photo){return {name:photo.name,dataUrl:photo.dataUrl};})
    })
  });
  var data=await res.json();
  if(!res.ok||!data.success){
    throw new Error(data&&data.message?data.message:'The request was saved, but photos could not be attached.');
  }
  return data;
}
async function submitPublicRequest(e){
  preventDefaultIfEvent(e);
  var category=document.getElementById('publicReqCategory').value;
  var location=document.getElementById('publicReqLocation').value.trim();
  var title=document.getElementById('publicReqTitle').value.trim();
  var description=document.getElementById('publicReqDescription').value.trim();
  var result=document.getElementById('publicRequestResult');
  result.className='public-request-result';
  result.textContent='';
  if(!category||!location||!title||!description){
    result.className='public-request-result error';
    result.textContent='Please add an issue type, location, short title, and description.';
    return;
  }
  result.className='public-request-result success';
  result.textContent='Submitting request...';
  try{
    var res=await fetch('/api/requests',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        category:category,
        address:location,
        title:title,
        description:description
      })
    });
    var data=await res.json();
    if(!res.ok||!data.request){
      throw new Error(data&&data.message?data.message:data&&data.error?data.error:'Unable to submit request.');
    }
    var trackingNumber=autoAddRequest(data.request);
    var photoMessage='';
    if(pendingPhotoUploads.length){
      try{
        var uploadResult=await uploadRequestPhotos(data.request,pendingPhotoUploads);
        photoMessage='<br/>Photos attached: <strong>'+escapeHtml(uploadResult.count||pendingPhotoUploads.length)+'</strong>.';
      }catch(photoErr){
        photoMessage='<br/><strong>Photo note:</strong> '+escapeHtml(photoErr&&photoErr.message?photoErr.message:'The request was saved, but photos could not be attached.');
      }
    }
    result.className='public-request-result success';
    result.innerHTML='Request submitted. Tracking number: <strong>'+escapeHtml(trackingNumber)+'</strong>'+photoMessage+'<br/>Borough staff can review it during normal operating hours. This portal is not for emergencies. For emergencies, call 911.<br/><button class="lookup-btn" type="button" data-check-tracking="'+escapeHtml(trackingNumber)+'">Check Status</button>';
    document.getElementById('publicReqLocation').value='';
    document.getElementById('publicReqTitle').value='';
    document.getElementById('publicReqDescription').value='';
    clearPublicRequestPhotoState();
  }catch(err){
    result.className='public-request-result error';
    result.textContent=err&&err.message?err.message:'Unable to submit request.';
  }
}
function formatRequestDate(value){
  if(!value)return new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
  var parsed=new Date(value);
  if(Number.isNaN(parsed.getTime()))return String(value);
  return parsed.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function normalizeCreatedRequestRecord(record){
  if(!record)return null;
  var trackingNumber=record.tracking_number||record.id||record.trackingNumber||'';
  var description=record.description||record.desc||'';
  var address=record.address||record.addr||'';
  var desc=description;
  if(address)desc=desc?desc+' - '+address:address;
  return {
    id:escapeHtml(trackingNumber||'Untracked'),
    requestId:record.id||null,
    trackingNumber:trackingNumber||'',
    title:escapeHtml(record.title||'Untitled request'),
    desc:escapeHtml(desc),
    cat:escapeHtml(record.category||record.cat||'Other'),
    status:normalizeUiStatus(record.status),
    date:escapeHtml(formatRequestDate(record.created_at||record.date)),
    created_at:record.created_at||record.date||null,
    updated_at:record.updated_at||null,
    priority:record.priority||'normal',
    assigned_to:record.assigned_to||'',
    internal_notes:record.internal_notes||'',
    source:record.source||'public',
    triage:record.triage||null
  };
}
function autoAddRequest(data){
  var normalized=normalizeCreatedRequestRecord(data);
  if(!normalized)return '';
  requests=[normalized].concat(requests.filter(function(existing){return existing.id!==normalized.id;}));
  renderRequests();
  return normalized.id;
}
async function loadStaffRequests(existingToken){
  if(!window.isStaffAuthenticated){
    return;
  }
  var token=existingToken||await getStaffAccessToken();
  var params=new URLSearchParams();
  var searchEl=document.getElementById('requestSearch');
  var statusEl=document.getElementById('requestStatusFilter');
  var sortEl=document.getElementById('requestSort');
  if(searchEl&&searchEl.value.trim())params.set('search',searchEl.value.trim());
  if(statusEl&&statusEl.value)params.set('status',statusEl.value);
  if(sortEl&&sortEl.value)params.set('sort',sortEl.value);
  var url='/api/requests'+(params.toString()?'?'+params.toString():'');
  var res=await fetch(url,{
    headers:{Authorization:'Bearer '+token}
  });
  var data=await res.json();
  if(res.status===401||res.status===403){
    setStaffSession(null,null);
    throw new Error(data&&data.message?data.message:'Staff session expired.');
  }
  if(!res.ok){
    throw new Error(data&&data.error?data.error:'Failed to load requests.');
  }
  requests=(data.requests||[]).map(normalizeCreatedRequestRecord).filter(Boolean);
  renderRequests();
}
async function updateRequestStatus(trackingNumber,status){
  if(!window.isStaffAuthenticated)return showLoginModal();
  try{
    var token=await getStaffAccessToken();
    var res=await fetch('/api/requests?tracking_number='+encodeURIComponent(trackingNumber),{
      method:'PATCH',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify({status:status})
    });
    var data=await res.json();
    if(!res.ok){
      if(res.status===401||res.status===403)setStaffSession(null,null);
      throw new Error(data&&data.message?data.message:'Failed to update request.');
    }
    await loadStaffRequests(token);
    if(currentStaffView==='dashboard')await fetchAdminMetrics(token);
    showToast('Request '+trackingNumber+' updated.');
  }catch(err){
    alert(err&&err.message?err.message:'Failed to update request.');
  }
}
function setDrawerStatus(message,isError){
  var status=document.getElementById('drawerSaveStatus');
  if(!status)return;
  status.textContent=message||'';
  status.style.color=isError?'var(--red)':'var(--text-mid)';
}
function drawerField(label,value){
  return '<div class="drawer-field"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value||'Not provided')+'</strong></div>';
}
function renderDrawerTriage(triage){
  var target=document.getElementById('drawerTriage');
  if(!target)return;
  if(!triage){
    target.innerHTML='<p class="drawer-empty">No triage data loaded.</p>';
    return;
  }
  target.innerHTML=triageBadgeHtml(triage)+triageSummaryHtml(triage);
}
function renderDrawerPhotos(photos){
  var target=document.getElementById('drawerPhotos');
  if(!target)return;
  if(!photos||!photos.length){
    target.innerHTML='<p class="drawer-empty">No photos attached to this request.</p>';
    return;
  }
  target.innerHTML=photos.map(function(photo,index){
    if(!photo.signed_url)return '';
    return '<a class="drawer-photo" href="'+escapeHtml(photo.signed_url)+'" target="_blank" rel="noopener" aria-label="Open attached photo '+(index+1)+'"><img src="'+escapeHtml(photo.signed_url)+'" alt="Attached request photo '+(index+1)+'"/></a>';
  }).join('')||'<p class="drawer-empty">Photos are attached, but signed access could not be created.</p>';
}
function timelineMetaText(event){
  var metadata=event&&event.metadata?event.metadata:{};
  var parts=[];
  if(metadata.from||metadata.to)parts.push((metadata.from||'blank')+' to '+(metadata.to||'blank'));
  if(metadata.status)parts.push('Status: '+metadata.status);
  if(metadata.photoCount)parts.push(metadata.photoCount+' photo'+(metadata.photoCount===1?'':'s'));
  if(Array.isArray(metadata.changedFields)&&metadata.changedFields.length)parts.push('Fields: '+metadata.changedFields.join(', '));
  return parts.join(' · ');
}
function renderDrawerTimeline(request,events){
  var target=document.getElementById('drawerTimeline');
  if(!target)return;
  var rows=[{
    label:'Submitted',
    timestamp:request.created_at,
    metadata:{status:request.status}
  }].concat(Array.isArray(events)?events:[]);
  target.innerHTML=rows.map(function(row){
    return '<div class="timeline-item"><strong>'+escapeHtml(row.label||'Activity')+'</strong><div>'+escapeHtml(formatAuditTime(row.timestamp||request.created_at))+'</div><div class="timeline-meta">'+escapeHtml(timelineMetaText(row))+'</div></div>';
  }).join('');
}
function renderDrawerDetails(payload){
  var request=payload.request||{};
  activeDrawerRequest=request;
  activeDrawerTrackingNumber=request.tracking_number||activeDrawerTrackingNumber;
  document.getElementById('drawerTitle').textContent=request.tracking_number||'Request Detail';
  document.getElementById('drawerSubtitle').textContent=(request.title||'Untitled request')+' · '+statusLabel(request.status);
  document.getElementById('drawerDetails').innerHTML=[
    drawerField('Tracking Number',request.tracking_number),
    drawerField('Status',statusLabel(request.status)),
    drawerField('Category',request.category),
    drawerField('Location',request.address),
    drawerField('Submitted',formatRequestDate(request.created_at)),
    drawerField('Source',request.source||'public')
  ].join('');
  document.getElementById('drawerDescription').textContent=request.description||'No description provided.';
  document.getElementById('drawerStatus').value=normalizeUiStatus(request.status);
  document.getElementById('drawerPriority').value=String(request.priority||'normal').toLowerCase();
  document.getElementById('drawerAssignedTo').value=request.assigned_to||'';
  document.getElementById('drawerInternalNotes').value=request.internal_notes||'';
  renderDrawerTriage(payload.triage||request.triage);
  renderDrawerPhotos(payload.photos||[]);
  renderDrawerTimeline(request,payload.events||[]);
  setDrawerStatus('');
}
function setDrawerLoading(trackingNumber){
  document.getElementById('drawerTitle').textContent=trackingNumber||'Request Detail';
  document.getElementById('drawerSubtitle').textContent='Loading request details...';
  document.getElementById('drawerDetails').innerHTML='';
  document.getElementById('drawerDescription').textContent='';
  document.getElementById('drawerTriage').innerHTML='<p class="drawer-empty">Loading triage...</p>';
  document.getElementById('drawerPhotos').innerHTML='<p class="drawer-empty">Loading photos...</p>';
  document.getElementById('drawerTimeline').innerHTML='<p class="drawer-empty">Loading timeline...</p>';
  setDrawerStatus('');
}
function openDrawerShell(trigger){
  var drawer=document.getElementById('requestDrawer');
  var backdrop=document.getElementById('drawerBackdrop');
  drawerReturnFocus=trigger||document.activeElement;
  drawer.classList.add('active');
  backdrop.classList.add('active');
  drawer.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  setTimeout(function(){document.getElementById('drawerCloseBtn').focus();},30);
}
function closeRequestDrawer(){
  var drawer=document.getElementById('requestDrawer');
  var backdrop=document.getElementById('drawerBackdrop');
  drawer.classList.remove('active');
  backdrop.classList.remove('active');
  drawer.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
  activeDrawerTrackingNumber=null;
  activeDrawerRequest=null;
  if(drawerReturnFocus&&typeof drawerReturnFocus.focus==='function'){
    drawerReturnFocus.focus();
  }
}
function trapLoginModalFocus(event){
  var modal=document.getElementById('login-modal');
  if(!modal||modal.style.display==='none')return;
  if(event.key==='Escape'){
    event.preventDefault();
    hideLoginModal();
    return;
  }
  if(event.key!=='Tab')return;
  var focusable=Array.from(modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function(el){return !el.disabled&&el.offsetParent!==null;});
  if(!focusable.length)return;
  var first=focusable[0];
  var last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();
    last.focus();
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();
    first.focus();
  }
}
async function openRequestDrawer(trackingNumber,trigger){
  if(!window.isStaffAuthenticated)return showLoginModal();
  activeDrawerTrackingNumber=trackingNumber;
  openDrawerShell(trigger);
  setDrawerLoading(trackingNumber);
  try{
    var token=await getStaffAccessToken();
    var res=await fetch('/api/requests?tracking_number='+encodeURIComponent(trackingNumber)+'&staff=1',{
      headers:{Authorization:'Bearer '+token}
    });
    var data=await res.json();
    if(!res.ok||!data.request){
      throw new Error(data&&data.message?data.message:data&&data.error?data.error:'Unable to load request detail.');
    }
    renderDrawerDetails(data);
  }catch(err){
    setDrawerStatus(err&&err.message?err.message:'Unable to load request detail.',true);
  }
}
async function saveRequestDrawer(){
  if(!activeDrawerTrackingNumber||!activeDrawerRequest)return;
  var payload={
    status:document.getElementById('drawerStatus').value,
    priority:document.getElementById('drawerPriority').value,
    assigned_to:document.getElementById('drawerAssignedTo').value.trim(),
    internal_notes:document.getElementById('drawerInternalNotes').value
  };
  setDrawerStatus('Saving...');
  document.getElementById('drawerSaveBtn').disabled=true;
  try{
    var token=await getStaffAccessToken();
    var res=await fetch('/api/requests?tracking_number='+encodeURIComponent(activeDrawerTrackingNumber),{
      method:'PATCH',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify(payload)
    });
    var data=await res.json();
    if(!res.ok){
      throw new Error(data&&data.message?data.message:data&&data.error?data.error:'Unable to save request.');
    }
    await loadStaffRequests(token);
    if(currentStaffView==='dashboard')await fetchAdminMetrics(token);
    await openRequestDrawer(activeDrawerTrackingNumber,drawerReturnFocus);
    showToast('Request '+activeDrawerTrackingNumber+' saved.');
  }catch(err){
    setDrawerStatus(err&&err.message?err.message:'Unable to save request.',true);
  }
  document.getElementById('drawerSaveBtn').disabled=false;
}
function trapDrawerFocus(event){
  var drawer=document.getElementById('requestDrawer');
  if(!drawer.classList.contains('active'))return;
  if(event.key==='Escape'){
    event.preventDefault();
    closeRequestDrawer();
    return;
  }
  if(event.key!=='Tab')return;
  var focusable=Array.from(drawer.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function(el){return !el.disabled&&el.offsetParent!==null;});
  if(!focusable.length)return;
  var first=focusable[0];
  var last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();
    last.focus();
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();
    first.focus();
  }
}
function escapeHtml(text){
  return String(text)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function addMessage(role,text){
  var msgs=document.getElementById('messages');
  var div=document.createElement('div');
  var avatar=document.createElement('div');
  var bubble=document.createElement('div');
  div.className='msg '+role;
  avatar.className='msg-avatar';
  avatar.textContent=role==='bot'?'M':'R';
  bubble.className='msg-bubble';
  bubble.textContent=text;
  div.appendChild(avatar);
  div.appendChild(bubble);
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;
}
function updateChatUI(text){
  addMessage('bot',text);
}
function showTyping(){
  var msgs=document.getElementById('messages');
  var div=document.createElement('div');
  div.className='msg bot';div.id='typing';
  div.innerHTML='<div class="msg-avatar">M</div><div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;
}
function removeTyping(){var t=document.getElementById('typing');if(t)t.remove();}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(e);}}
function quickSend(text){document.getElementById('chatInput').value=text;sendMessage();}
async function sendMessage(e){
  preventDefaultIfEvent(e);
  var input=document.getElementById('chatInput');
  var text=input.value.trim();
  var responsePayload=null;
  if(!text||isLoading)return;
  input.value='';isLoading=true;
  document.getElementById('sendBtn').disabled=true;
  addMessage('user',text);
  convHistory.push({role:'user',content:text});
  showTyping();
  try{
    var res=await fetch('/api/chat',{
      method:'POST',
      headers:{
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        messages:convHistory,
        previousResponseId:lastResponseId
      })
    });
    const data=await res.json();
    responsePayload=data;
    removeTyping();
    if(data&&(data.success||(!Object.prototype.hasOwnProperty.call(data,'success')&&typeof data.reply==='string'))){
      var reply=typeof data.reply==='string'?data.reply:'';
      if(!reply)reply="I'm having trouble right now. Please call Borough Hall at (856) 783-1520.";
      if(typeof data.responseId==='string'&&data.responseId){
        lastResponseId=data.responseId;
      }
      if(data.createdRequest){
        var newId=autoAddRequest(data.createdRequest);
        if(newId){
          var trackingPattern=/MGN-(?:\d{4}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8})/g;
          if(trackingPattern.test(reply)){
            trackingPattern.lastIndex=0;
            reply=reply.replace(trackingPattern,newId);
          }else{
            reply=reply+'\n\nYour tracking number is '+newId+'. You can check the status anytime in the Service Requests tab.';
          }
        }
      }
      convHistory.push({role:'assistant',content:reply});
      updateChatUI(reply);
    }else{
      console.error('API Error:',data&&data.error,data&&data.message);
      var message=data&&typeof data.message==='string'?data.message:"I'm having trouble connecting right now. Please try again or call Borough Hall at (856) 783-1520.";
      updateChatUI(message);
    }
  }catch(err){
    removeTyping();
    if(responsePayload)console.error('API Error payload:',responsePayload);
    updateChatUI("I'm having trouble connecting right now. Please try again or call Borough Hall at (856) 783-1520.");
    console.error('API Error:',err);
  }
  isLoading=false;
  document.getElementById('sendBtn').disabled=false;
}
function showToast(msg){
  var t=document.createElement('div');t.className='toast';t.textContent=msg;
  t.setAttribute('role','status');
  t.setAttribute('aria-live','polite');
  document.body.appendChild(t);setTimeout(function(){t.remove();},3000);
}
function initInteractiveControls(){
  function bindClick(id,handler){
    var el=document.getElementById(id);
    if(el)el.addEventListener('click',handler);
  }
  var footerName=document.getElementById('footerBoroughName');
  var footerCountyState=document.getElementById('footerCountyState');
  var footerContact=document.getElementById('footerContact');
  if(footerName)footerName.textContent=BOROUGH_CONFIG.name;
  if(footerCountyState)footerCountyState.textContent=BOROUGH_CONFIG.county+', '+BOROUGH_CONFIG.state;
  if(footerContact)footerContact.textContent=BOROUGH_CONFIG.hallAddress+' | '+BOROUGH_CONFIG.phone;
  bindClick('adminToggle',toggleAdmin);
  bindClick('passwordResetBtn',sendStaffPasswordReset);
  bindClick('loginCancelBtn',hideLoginModal);
  bindClick('loginSubmit',handleLoginPrimaryAction);
  bindClick('sendBtn',sendMessage);
  bindClick('postAnnouncementBtn',postAnnouncement);
  bindClick('lookupBtn',lookupTicket);
  bindClick('addRequestBtn',addRequest);
  bindClick('publicRequestSubmitBtn',submitPublicRequest);
  bindClick('applyRequestFiltersBtn',function(){loadStaffRequests();});
  bindClick('dashboardRefreshBtn',refreshStaffData);
  bindClick('drawerCloseBtn',closeRequestDrawer);
  bindClick('drawerBackdrop',closeRequestDrawer);
  bindClick('drawerSaveBtn',saveRequestDrawer);
  document.addEventListener('keydown',trapLoginModalFocus);
  document.addEventListener('keydown',trapDrawerFocus);
  var publicPhotos=document.getElementById('publicReqPhotos');
  if(publicPhotos)publicPhotos.addEventListener('change',handlePhotoSelection);
  var photoGrid=document.getElementById('photoPreviewGrid');
  if(photoGrid){
    photoGrid.addEventListener('click',function(event){
      var button=event.target.closest('[data-remove-photo]');
      if(!button)return;
      var index=Number(button.getAttribute('data-remove-photo'));
      if(Number.isFinite(index)){
        pendingPhotoUploads.splice(index,1);
        renderPhotoPreviews();
        setPhotoError('');
      }
    });
  }
  document.querySelectorAll('[data-tab]').forEach(function(button){
    button.addEventListener('click',function(){
      switchTab(button.getAttribute('data-tab'),button);
    });
  });
  document.querySelectorAll('[data-staff-view]').forEach(function(button){
    button.addEventListener('click',function(){
      if(button.getAttribute('data-staff-view')==='dashboard'){
        showStaffDashboard();
      }else{
        showResidentView();
      }
    });
  });
  ['staffPassword','staffMfaCode','staffConfirmPassword'].forEach(function(id){
    var input=document.getElementById(id);
    if(input)input.addEventListener('keydown',function(event){
      if(event.key==='Enter')handleLoginPrimaryAction();
    });
  });
  var chatInput=document.getElementById('chatInput');
  if(chatInput)chatInput.addEventListener('keydown',handleKey);
  var requestSort=document.getElementById('requestSort');
  if(requestSort)requestSort.addEventListener('change',function(){
    if(window.isStaffAuthenticated)loadStaffRequests();
  });
  document.querySelectorAll('[data-action]').forEach(function(button){
    button.addEventListener('click',function(){
      handleResidentAction(button.getAttribute('data-action'));
    });
  });
  document.querySelectorAll('[data-prompt]').forEach(function(button){
    button.addEventListener('click',function(){
      quickSend(button.getAttribute('data-prompt')||'');
    });
  });
  var requestList=document.getElementById('reqList');
  if(requestList){
    requestList.addEventListener('click',function(event){
      var detailButton=event.target.closest('[data-request-detail]');
      if(detailButton){
        openRequestDrawer(detailButton.getAttribute('data-request-detail'),detailButton);
        return;
      }
      var button=event.target.closest('[data-request-update]');
      if(button){
        updateRequestStatus(button.getAttribute('data-request-id'),button.getAttribute('data-request-update'));
        return;
      }
      var card=event.target.closest('[data-request-card]');
      if(!card||event.target.closest('button'))return;
      openRequestDrawer(card.getAttribute('data-request-card'),card);
    });
    requestList.addEventListener('keydown',function(event){
      if(event.key!=='Enter'&&event.key!==' ')return;
      var card=event.target.closest('[data-request-card]');
      if(!card||event.target.closest('button'))return;
      event.preventDefault();
      openRequestDrawer(card.getAttribute('data-request-card'),card);
    });
  }
  var publicRequestResult=document.getElementById('publicRequestResult');
  if(publicRequestResult){
    publicRequestResult.addEventListener('click',function(event){
      var button=event.target.closest('[data-check-tracking]');
      if(!button)return;
      document.getElementById('lookupInput').value=button.getAttribute('data-check-tracking')||'';
      focusRequestLookup();
      setTimeout(lookupTicket,150);
    });
  }
}
populateResidentDepth();initInteractiveControls();renderAnnouncements();renderRequests();loadAnnouncements();initStaffAuth();
