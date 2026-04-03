export function GET() {
  return new Response(HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Chat</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
#join{display:flex;gap:8px;justify-content:center;align-items:center;height:100dvh;padding:16px}
#join input{width:200px}
#app{display:none;flex-direction:column;height:100dvh}
#hdr{padding:10px 16px;border-bottom:1px solid #222;font-size:14px;color:#888;display:flex;justify-content:space-between;align-items:center;gap:8px}
select{background:#1a1a1a;border:1px solid #333;color:#e5e5e5;padding:6px 10px;border-radius:6px;font-size:14px;font-weight:600;outline:none;cursor:pointer;max-width:180px}
select:focus{border-color:#3b82f6}
#hdr .right{display:flex;align-items:center;gap:8px}
#hdr span{font-size:12px;color:#555}
#msgs{flex:1;overflow-y:auto;padding:12px 16px;-webkit-overflow-scrolling:touch}
.m{margin-bottom:10px}
.m .h{font-size:12px;margin-bottom:1px}
.m .n{font-weight:600;color:#3b82f6}
.m .self .n{color:#10b981}
.m .t{color:#555;margin-left:6px}
.m .b{word-wrap:break-word;line-height:1.4;white-space:pre-wrap}
.sys{color:#888;font-style:italic;font-size:13px;margin-bottom:10px}
#form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #222;background:#0a0a0a}
input{background:#1a1a1a;border:1px solid #333;color:#e5e5e5;padding:8px 12px;border-radius:6px;font-size:14px;outline:none}
input:focus{border-color:#3b82f6}
#msg{flex:1;min-width:0}
button{background:#3b82f6;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500}
button:active{background:#1d4ed8}
#nochan{flex:1;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px;padding:16px;text-align:center}
</style>
</head>
<body>
<div id="join">
  <input id="nick" placeholder="Your name" maxlength="30" autofocus>
  <button onclick="go()">Join</button>
</div>
<div id="app">
  <div id="hdr">
    <select id="chsel" onchange="switchCh()"></select>
    <div class="right"><span id="status"></span></div>
  </div>
  <div id="nochan">/join #channel to start chatting<br>/part to leave</div>
  <div id="msgs"></div>
  <form id="form">
    <input id="msg" placeholder="Message" autocomplete="off" maxlength="2000">
    <button type="submit">Send</button>
  </form>
</div>
<script>
var nick,last=0,msgs=document.getElementById('msgs'),poll,channels=[],curCh='';

function go(){
  nick=(document.getElementById('nick').value||'').trim();
  if(!nick)return;
  document.getElementById('join').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('msg').focus();
  var pathCh=location.pathname.replace(/^\\/chat\\/?#?/,'').replace(/[^a-z0-9_-]/gi,'').toLowerCase();
  if(pathCh){handleCmd('/join #'+pathCh)}
  else{updateSelect()}
}

document.getElementById('nick').addEventListener('keydown',function(e){if(e.key==='Enter')go()});

document.getElementById('form').addEventListener('submit',function(e){
  e.preventDefault();
  var inp=document.getElementById('msg'),t=inp.value.trim();
  if(!t)return;
  inp.value='';
  if(handleCmd(t))return;
  if(!curCh){sysMsg('Use /join #channel first');return}
  fetch('/api/chat/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({u:nick,m:t,ch:curCh})}).then(tick);
});

function handleCmd(t){
  var join=t.match(/^\\/join\\s+#?(\\S+)/i);
  if(join){
    var ch=join[1].toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,50);
    if(!ch){sysMsg('Invalid channel name');return true}
    if(channels.indexOf(ch)===-1)channels.push(ch);
    curCh=ch;
    updateSelect();
    resetMessages();
    sysMsg('Joined #'+ch);
    startPoll();
    return true;
  }
  if(/^\\/clear$/i.test(t)){
    if(!curCh){sysMsg('Not in a channel');return true}
    fetch('/api/chat/messages?ch='+encodeURIComponent(curCh),{method:'DELETE'}).then(function(){
      resetMessages();sysMsg('Channel #'+curCh+' cleared');
    });
    return true;
  }
  if(/^\\/part$/i.test(t)){
    if(!curCh){sysMsg('Not in a channel');return true}
    var left=curCh;
    channels=channels.filter(function(c){return c!==curCh});
    curCh=channels.length?channels[0]:'';
    updateSelect();
    resetMessages();
    sysMsg('Left #'+left);
    if(curCh)startPoll();else stopPoll();
    return true;
  }
  return false;
}

function sysMsg(t){
  var d=document.createElement('div');d.className='sys';d.textContent=t;
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
}

function updateSelect(){
  var sel=document.getElementById('chsel');
  var noch=document.getElementById('nochan');
  sel.innerHTML='';
  if(!channels.length){
    var o=document.createElement('option');o.textContent='No channels';o.disabled=true;sel.appendChild(o);
    noch.style.display='flex';
    msgs.style.display='none';
    document.getElementById('form').querySelector('button').disabled=false;
    return;
  }
  noch.style.display='none';
  msgs.style.display='block';
  for(var i=0;i<channels.length;i++){
    var o=document.createElement('option');
    o.value=channels[i];o.textContent='#'+channels[i];
    if(channels[i]===curCh)o.selected=true;
    sel.appendChild(o);
  }
}

function switchCh(){
  var sel=document.getElementById('chsel');
  curCh=sel.value;
  resetMessages();
  startPoll();
}

function resetMessages(){
  last=0;
  msgs.innerHTML='';
}

function startPoll(){
  stopPoll();
  tick();
  poll=setInterval(tick,1500);
}

function stopPoll(){
  if(poll){clearInterval(poll);poll=null}
}

function tick(){
  if(!curCh)return;
  fetch('/api/chat/messages?ch='+encodeURIComponent(curCh)+'&after='+last).then(function(r){return r.json()}).then(function(arr){
    if(!arr.length)return;
    var atBottom=msgs.scrollHeight-msgs.scrollTop-msgs.clientHeight<60;
    var frag=document.createDocumentFragment();
    for(var i=0;i<arr.length;i++){
      var d=arr[i],div=document.createElement('div');div.className='m';
      var h=document.createElement('div');h.className='h'+(d.u===nick?' self':'');
      var n=document.createElement('span');n.className='n';n.textContent=d.u;
      var t=document.createElement('span');t.className='t';
      var dt=new Date(d.t);t.textContent=dt.getHours().toString().padStart(2,'0')+':'+dt.getMinutes().toString().padStart(2,'0');
      h.appendChild(n);h.appendChild(t);
      var b=document.createElement('div');b.className='b';b.textContent=d.m;
      div.appendChild(h);div.appendChild(b);frag.appendChild(div);
      last=d.id;
    }
    msgs.appendChild(frag);
    if(atBottom)msgs.scrollTop=msgs.scrollHeight;
    document.getElementById('status').textContent=arr.length+' new';
    setTimeout(function(){document.getElementById('status').textContent=''},2000);
  }).catch(function(){});
}
</script>
</body>
</html>`
