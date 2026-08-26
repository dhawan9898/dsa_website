/* ==========================================================================
   VizDS — shared playback engine for interactive data-structure pages.

   Unlike shared/engine.js (which runs one algorithm start-to-finish on a
   fixed array), a data structure PERSISTS: you press Insert, then Delete,
   then Search, each building on whatever the last operation left behind.
   VizDS keeps one continuous, ever-growing frame timeline — every operation
   appends a fresh batch of step-frames computed from the current live state,
   then auto-plays into them. Scrubbing back simply revisits earlier
   operations; nothing is ever thrown away.

   Usage:

     VizDS.init({
       init: function(){ return {state: <initial state>, frames:[<seed frame(s)>]}; },
       ops: {
         push: { btn:"btnPush", enterOn:"val",
           run: function(state){
             var v = Number(document.getElementById("val").value);
             if(!isFinite(v)) return {error:"Enter a number to push."};
             // ...compute a fresh array of step-frames from `state`...
             return {frames: frames, state: newState};
           } }
       },
       renderExtra: function(frame, ctx){ DSRender.____(...) }, // draw frame.struct
       statLabels: [{key:"ops", label:"Operations"}]   // 'phase' is automatic
     });

   A frame is a plain object: { struct, narr, phase, code, codeLine, <statKeys>... }
   where `struct` is whatever shape the page's chosen DSRender function expects.
   `code` (optional array of C source lines, e.g. a shared `var PUSH_CODE=[...]`
   an op defines once) and `codeLine` (index into it, or [start,end] for a block)
   render into #codeHost when present — see shared/engine.js's header for the
   exact same contract, shared verbatim between both engines. Omit on frames
   where no particular line applies; the panel just keeps its last state.

   For the non-interactive notes-page demo:

     VizDS.loopDemo({ frames: [...], renderExtra: fn, intervalMs: 900 });
   ========================================================================== */
(function(window){
  "use strict";

  function $(id){ return document.getElementById(id); }

  var S = { frames:[], cur:0, playing:false, timer:null, cfg:null, state:null, statEls:{}, codeArr:null, codeEls:null };

  function codeLineSet(codeLine){
    if(codeLine===undefined || codeLine===null) return [];
    if(typeof codeLine==="number") return [codeLine];
    var out=[]; for(var i=codeLine[0]; i<=codeLine[1]; i++) out.push(i);
    return out;
  }

  function renderCode(host, code, codeLine){
    if(!host) return;
    if(code && code!==S.codeArr){
      host.innerHTML="";
      S.codeArr=code;
      S.codeEls=[];
      for(var i=0;i<code.length;i++){
        var line=document.createElement("div"); line.className="code-line";
        line.innerHTML='<span class="code-ln">'+(i+1)+'</span><span class="code-src"></span>';
        line.lastChild.textContent=code[i];
        host.appendChild(line);
        S.codeEls.push(line);
      }
    }
    if(!S.codeEls) return;
    var active=codeLineSet(codeLine);
    for(var j=0;j<S.codeEls.length;j++){
      S.codeEls[j].className="code-line"+(active.indexOf(j)>=0?" active":"");
    }
    if(active.length && S.codeEls[active[0]]){
      var hostR=host.getBoundingClientRect(), lineR=S.codeEls[active[0]].getBoundingClientRect();
      if(lineR.top<hostR.top) host.scrollTop+=(lineR.top-hostR.top);
      else if(lineR.bottom>hostR.bottom) host.scrollTop+=(lineR.bottom-hostR.bottom);
    }
  }

  function buildStatsHost(){
    var host=$("statsHost");
    if(!host) return;
    host.innerHTML="";
    S.statEls={};
    var labels=(S.cfg.statLabels||[]).concat([{key:"phase",label:"Phase"}]);
    labels.forEach(function(L){
      var span=document.createElement("span");
      var b=document.createElement("b"); b.id="stat_"+L.key; b.textContent=L.key==="phase"?"ready":"0";
      span.appendChild(document.createTextNode(L.label));
      span.appendChild(b);
      host.appendChild(span);
      S.statEls[L.key]=b;
    });
  }

  function setHint(text, bad){
    var h=$("hint"); if(!h) return;
    h.className="hint"+(bad?" bad":"");
    h.textContent=text||"";
  }

  function render(){
    var f=S.frames[S.cur]; if(!f) return;
    var narr=$("narr"); if(narr) narr.textContent=f.narr||"";
    renderCode($("codeHost"), f.code, f.codeLine);

    for(var key in S.statEls){
      var val = key==="phase" ? String(f.phase||"").replace(/-/g," ") : (f[key]===undefined?0:f[key]);
      S.statEls[key].textContent=val;
    }

    var scrub=$("scrub"), scrubLbl=$("scrubLbl");
    if(scrub) scrub.value=S.cur;
    if(scrubLbl) scrubLbl.textContent=S.cur+" / "+(S.frames.length-1);

    var log=$("log");
    if(log){
      var ul=log.firstElementChild;
      ul.innerHTML="";
      for(var q=Math.max(0,S.cur-39); q<=S.cur; q++){
        var li=document.createElement("li");
        li.innerHTML='<span class="n">'+q+'</span><span></span>';
        li.lastChild.textContent=S.frames[q].narr||"";
        ul.appendChild(li);
      }
      log.scrollTop=log.scrollHeight;
    }

    if(typeof S.cfg.renderExtra==="function"){
      S.cfg.renderExtra(f, {cur:S.cur, frames:S.frames});
    }
  }

  function stop(){
    S.playing=false;
    if(S.timer){ clearInterval(S.timer); S.timer=null; }
    var p=$("play"); if(p) p.textContent="Play";
  }
  function play(){
    if(S.cur>=S.frames.length-1) S.cur=0;
    S.playing=true;
    var p=$("play"); if(p) p.textContent="Pause";
    tick();
  }
  function tick(){
    if(S.timer) clearInterval(S.timer);
    var speed=$("speed");
    S.timer=setInterval(function(){
      if(S.cur>=S.frames.length-1){ stop(); return; }
      S.cur++; render();
    }, Number(speed?speed.value:700));
  }

  function runOp(name){
    var op=(S.cfg.ops||{})[name];
    if(!op) return;
    var result;
    try{ result=op.run(S.state); }
    catch(e){ setHint("That operation hit an unexpected problem: "+e.message, true); return; }
    if(!result || result.error){
      setHint((result&&result.error)||"That operation isn't valid right now.", true);
      return;
    }
    setHint(result.hint||"");
    var startIdx=S.frames.length;
    S.frames=S.frames.concat(result.frames);
    S.state=result.state;
    var scrub=$("scrub"); if(scrub) scrub.max=S.frames.length-1;
    S.cur=Math.max(0,startIdx-1);
    render();
    play();
  }

  function wireCommon(){
    var playBtn=$("play"), fwdBtn=$("fwd"), backBtn=$("back"), resetBtn=$("reset"), speedEl=$("speed"), scrubEl=$("scrub");
    if(playBtn) playBtn.addEventListener("click", function(){ S.playing?stop():play(); });
    if(fwdBtn) fwdBtn.addEventListener("click", function(){ stop(); if(S.cur<S.frames.length-1){ S.cur++; render(); } });
    if(backBtn) backBtn.addEventListener("click", function(){ stop(); if(S.cur>0){ S.cur--; render(); } });
    if(resetBtn) resetBtn.addEventListener("click", function(){ stop(); S.cur=0; render(); });
    if(speedEl) speedEl.addEventListener("input", function(){ if(S.playing) tick(); });
    if(scrubEl) scrubEl.addEventListener("input", function(){ stop(); S.cur=Number(this.value); render(); });

    document.addEventListener("keydown", function(e){
      if(e.target.tagName==="INPUT") return;
      if(e.key==="ArrowRight"){ e.preventDefault(); if(fwdBtn) fwdBtn.click(); }
      if(e.key==="ArrowLeft"){ e.preventDefault(); if(backBtn) backBtn.click(); }
      if(e.key===" "){ e.preventDefault(); if(playBtn) playBtn.click(); }
    });

    var rt;
    window.addEventListener("resize", function(){ clearTimeout(rt); rt=setTimeout(render,120); });
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(render);
  }

  function wireOps(){
    var ops=S.cfg.ops||{};
    Object.keys(ops).forEach(function(name){
      var op=ops[name];
      var btn=$(op.btn);
      if(btn) btn.addEventListener("click", function(){ runOp(name); });
      if(op.enterOn){
        var field=$(op.enterOn);
        if(field) field.addEventListener("keydown", function(e){ if(e.key==="Enter") runOp(name); });
      }
    });
  }

  window.VizDS = {
    init: function(cfg){
      S.cfg=cfg;
      var seed=cfg.init();
      S.state=seed.state;
      S.frames=seed.frames.slice();
      S.cur=0;
      buildStatsHost();
      var scrub=$("scrub"); if(scrub) scrub.max=S.frames.length-1;
      wireCommon();
      wireOps();
      render();
    },
    loopDemo: function(cfg){
      var frames=cfg.frames, i=0;
      var speedMs=cfg.intervalMs||900;
      function step(){
        var f=frames[i];
        cfg.renderExtra(f, {cur:i, frames:frames});
        renderCode($("codeHost"), f.code, f.codeLine);
        i=(i+1)%frames.length;
      }
      step();
      var timer=setInterval(step, speedMs);
      var rt;
      window.addEventListener("resize", function(){ clearTimeout(rt); rt=setTimeout(function(){
        cfg.renderExtra(frames[(i-1+frames.length)%frames.length], {cur:i, frames:frames});
      },120); });
      return { stop: function(){ clearInterval(timer); } };
    },
    state: S
  };

})(window);
