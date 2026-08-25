/* ==========================================================================
   Viz — shared playback engine for the DSA visualizer site.

   Each algorithm page supplies only the bespoke part (the frame generator
   that actually runs the algorithm and narrates each step); this file owns
   everything generic: input parsing, the random-array button, play/pause/
   step/back/reset, the speed and scrub sliders, the stats row, the
   narration line, the scrolling log, and keyboard shortcuts.

   Usage (see any *-visualizer.html for a concrete example):

     Viz.init({
       defaultInput: "5, 2, 9, 1, 5, 6",
       minN: 2, maxN: 16,
       needsTarget: false,        // renders/reads a #target field when true
       sortRequired: false,       // input is sorted ascending before build()
       validateValue: fn(x)->bool,// optional extra per-value filter
       valueErrorMsg: "...",      // shown when validateValue rejects values
       build: function(array, target){ return frames; },
       statLabels: [{key:'cmp', label:'Comparisons'}, ...], // 'phase' is automatic
       renderExtra: function(frame, ctx){ ... } // optional page-specific visual
     });

   A frame is a plain object: { array, roles, narr, phase, code, codeLine, <statKeys>... }
   - array: current array state (values, or null for an empty slot)
   - roles: array parallel to `array`, each entry a space-separated class
            string (e.g. "left head") or "" / null / undefined
   - code: optional array of C source lines (a shared `var CODE=[...]` the page
           defines once and every frame references — not copied per frame)
   - codeLine: optional index into `code`, or [start,end] to highlight a block.
           Renders into #codeHost if the page has one; omit on frames where no
           particular line applies (e.g. a "start"/"done" summary frame) and
           the panel just keeps showing the code with nothing highlighted.
   ========================================================================== */
(function(window){
  "use strict";

  function $(id){ return document.getElementById(id); }
  function div(cls){ var d=document.createElement("div"); d.className=cls; return d; }

  var S = { frames:[], cur:0, playing:false, timer:null, cfg:null, statEls:{}, codeArr:null, codeEls:null };

  function renderArray(host, arr, roles){
    if(!host) return;
    host.innerHTML="";
    for(var i=0;i<arr.length;i++){
      var item=div("array-item");
      var cls="cell"+(roles && roles[i] ? " "+roles[i] : "");
      var c=div(cls);
      var v=arr[i];
      c.textContent=(v===null||v===undefined)?"·":v;
      item.appendChild(c);
      var idx=div("array-idx"); idx.textContent=i;
      item.appendChild(idx);
      host.appendChild(item);
    }
  }

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
        var line=div("code-line");
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
    if(active.length && S.codeEls[active[0]] && S.codeEls[active[0]].scrollIntoView){
      S.codeEls[active[0]].scrollIntoView({block:"nearest"});
    }
  }

  function buildStatsHost(){
    var host=$("statsHost");
    if(!host) return;
    host.innerHTML="";
    S.statEls={};
    var labels=(S.cfg.statLabels||[]).concat([{key:"phase",label:"Phase"}]);
    for(var i=0;i<labels.length;i++){
      var L=labels[i];
      var span=document.createElement("span");
      var b=document.createElement("b"); b.id="stat_"+L.key; b.textContent=L.key==="phase"?"ready":"0";
      span.appendChild(document.createTextNode(L.label));
      span.appendChild(b);
      host.appendChild(span);
      S.statEls[L.key]=b;
    }
  }

  function render(){
    var f=S.frames[S.cur]; if(!f) return;
    renderArray($("arrayHost"), f.array, f.roles);

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
      S.cfg.renderExtra(f, {cur:S.cur, frames:S.frames, $:$, div:div});
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

  function parseNumberList(text){
    var raw=text.split(/[\s,;]+/).filter(function(x){ return x.length; });
    return raw.map(Number).filter(function(x){ return isFinite(x); });
  }

  function setHint(text, bad){
    var h=$("hint"); if(!h) return;
    h.className="hint"+(bad?" bad":"");
    h.textContent=text;
  }

  function load(){
    var cfg=S.cfg;
    var input=$("input");
    var nums=parseNumberList(input?input.value:"");
    if(cfg.validateValue){
      nums=nums.filter(cfg.validateValue);
    }
    var minN=cfg.minN||2, maxN=cfg.maxN||16;
    if(nums.length<minN){
      setHint(cfg.valueErrorMsg && nums.length===0 ? cfg.valueErrorMsg
        : "Enter at least "+minN+" numbers, separated by commas.", true);
      return;
    }
    var trimmedNote="";
    if(nums.length>maxN){
      nums=nums.slice(0,maxN);
      trimmedNote="Using the first "+maxN+" numbers so the layout stays readable. ";
    }
    if(cfg.sortRequired){
      nums=nums.slice().sort(function(a,b){ return a-b; });
      trimmedNote+="Array sorted ascending first, since this algorithm needs sorted input. ";
    }

    var target;
    if(cfg.needsTarget){
      var tEl=$("target");
      target=Number(tEl?tEl.value:NaN);
      if(!isFinite(target)){
        setHint("Enter a target number to search for.", true);
        return;
      }
    }

    setHint(trimmedNote || ("Loaded "+nums.length+" numbers. Press Play, or step through one action at a time."));

    stop();
    S.frames=cfg.build(nums, target);
    S.cur=0;
    buildStatsHost();
    var scrub=$("scrub");
    if(scrub) scrub.max=S.frames.length-1;
    render();
  }

  function randomArray(cfg){
    var n=6+Math.floor(Math.random()*(Math.min(cfg.maxN||16,11)-6+1));
    var out=[];
    for(var i=0;i<n;i++) out.push(1+Math.floor(Math.random()*99));
    return out;
  }

  function wireControls(){
    var loadBtn=$("load"), inputEl=$("input"), randBtn=$("rand");
    if(loadBtn) loadBtn.addEventListener("click", load);
    if(inputEl) inputEl.addEventListener("keydown", function(e){ if(e.key==="Enter") load(); });
    var targetEl=$("target");
    if(targetEl) targetEl.addEventListener("keydown", function(e){ if(e.key==="Enter") load(); });

    if(randBtn) randBtn.addEventListener("click", function(){
      var cfg=S.cfg;
      var arr=(typeof cfg.random==="function") ? cfg.random() : randomArray(cfg);
      if(inputEl) inputEl.value=arr.join(", ");
      if(cfg.needsTarget && targetEl){
        var pickExisting=Math.random()<0.7;
        var t=pickExisting ? arr[Math.floor(Math.random()*arr.length)] : (1+Math.floor(Math.random()*99));
        targetEl.value=t;
      }
      load();
    });

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
  }

  window.Viz = {
    init: function(cfg){
      S.cfg=cfg;
      var input=$("input");
      if(input && cfg.defaultInput!==undefined) input.value=cfg.defaultInput;
      var targetEl=$("target");
      if(targetEl && cfg.defaultTarget!==undefined) targetEl.value=cfg.defaultTarget;
      wireControls();
      load();
    },
    render: render,
    state: S
  };

})(window);
