/* ==========================================================================
   BarsAnim — a step-at-a-time renderer for an array drawn as value bars.

   The sorting/searching sibling of ArrAnim: a row of vertical bars, one per
   array slot, height proportional to the value. Bars are persistent per SLOT
   index, so when a sort swaps two values the two bars' heights transition into
   each other (a smooth morph) instead of popping. Pointer tags (i, j, min, lo,
   hi, mid, pivot) glide to whichever slot they mark; per-bar classes recolor a
   bar as it is compared, swapped, eliminated, or locked in as sorted/found.

   A frame is a whole-array snapshot:
     {
       bars: [ { val, cls, ptrs } , ... ],   // parallel to the array
       code, codeLines, narr, note
     }
   bar cls (space-separated ok): "a" (compare A, red) | "b" (compare B, blue) |
     "pivot" | "sorted" (green, locked) | "dim" (eliminated/out of range) |
     "found" (green highlight) | "active".

   API mirrors ArrAnim (no SVG needed):
     BarsAnim.play({ host, narrEl, codeHost, code, frames, ms }) -> {stop,start,go}
     BarsAnim.render(host, frame)
     BarsAnim.renderCode(host, lines, codeLine)
     BarsAnim.injectCSS()
   ========================================================================== */
(function(window){
  "use strict";
  var PLOT=150, BARW=38, GAP=8, PADX=8, PTR_COLOR={ i:"var(--stamp)", j:"var(--plot)", min:"var(--seal)", key:"var(--stamp)", pivot:"var(--stamp)", lo:"var(--plot)", hi:"var(--plot)", mid:"var(--stamp)", cur:"var(--stamp)" };

  function lineSet(cl){ if(cl==null) return []; if(typeof cl==="number") return [cl];
    var a=[]; for(var i=cl[0];i<=cl[1];i++) a.push(i); return a; }
  function renderCode(host, lines, cl){
    if(!host) return;
    if(!lines){ host.innerHTML=""; host._els=null; host._src=null; return; }
    if(!host._els || host._src!==lines){
      host.innerHTML=""; host._els=[]; host._src=lines;
      lines.forEach(function(src,i){
        var d=document.createElement("div"); d.className="code-line";
        d.innerHTML='<span class="code-ln">'+(i+1)+'</span><span class="code-src"></span>';
        d.lastChild.textContent=src; host.appendChild(d); host._els.push(d);
      });
    }
    var set=lineSet(cl);
    host._els.forEach(function(el,j){ el.className="code-line"+(set.indexOf(j)>=0?" active":""); });
  }

  var cssInjected=false;
  function injectCSS(){
    if(cssInjected) return; cssInjected=true;
    var css=[
      ".bars-stage{position:relative;overflow-x:auto;overflow-y:visible;padding-top:26px}",
      ".bars-row{position:relative;display:flex;align-items:flex-end;gap:"+GAP+"px;padding:0 "+PADX+"px;min-height:"+PLOT+"px}",
      ".bcol{position:relative;width:"+BARW+"px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}",
      ".bcol .bar{width:100%;background:var(--plot,#1F4E79);border-radius:4px 4px 0 0;transition:height .4s var(--ease,ease),background .3s var(--ease,ease),opacity .3s var(--ease,ease);min-height:3px}",
      ".bcol .bval{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink,#1C2B24);margin-top:4px}",
      ".bcol .bidx{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--ink-soft,#5D6E61)}",
      ".bcol.a .bar{background:var(--stamp,#BE3A1D)}",
      ".bcol.b .bar{background:var(--plot,#1F4E79)}",
      ".bcol.pivot .bar{background:#B07A17}",
      ".bcol.sorted .bar{background:var(--seal,#2E6B4F)}",
      ".bcol.found .bar{background:var(--seal,#2E6B4F);box-shadow:0 0 0 3px rgba(46,107,79,.28)}",
      ".bcol.active .bar{background:var(--stamp,#BE3A1D)}",
      ".bcol.dim .bar{opacity:.28}",
      ".bcol.dim .bval{opacity:.4}",
      ".bptr{position:absolute;top:-24px;left:50%;transform:translateX(-50%);font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;color:#fff;background:var(--pc,#1F4E79);padding:1px 6px;border-radius:4px;white-space:nowrap;transition:opacity .2s var(--ease,ease)}",
      ".bars-ctrls{display:flex;align-items:center;gap:7px;margin:12px 0 2px;flex-wrap:wrap}",
      ".bars-cbtn{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:14px;line-height:1;padding:7px 13px;border:1px solid var(--ink,#1C2B24);background:#F4F7EE;color:var(--ink,#1C2B24);border-radius:5px;cursor:pointer}",
      ".bars-cbtn:hover{background:var(--ink,#1C2B24);color:var(--paper,#EAEFE2)}",
      ".bars-step{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-soft,#5D6E61);margin-left:6px}"
    ].join("\n");
    var s=document.createElement("style"); s.setAttribute("data-bars-anim","1");
    s.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(s);
  }
  function cbtn(txt,label){ var b=document.createElement("button"); b.type="button"; b.className="bars-cbtn"; b.textContent=txt; b.setAttribute("aria-label",label); return b; }

  function render(host, frame){
    injectCSS();
    var bars=frame.bars||[];
    var row=host._row;
    if(!row){ row=document.createElement("div"); row.className="bars-row"; host.appendChild(row); host._row=row; host._cols=[]; }
    var maxV=1; bars.forEach(function(b){ if(b && b.val>maxV) maxV=b.val; });
    // build/trim columns
    while(host._cols.length<bars.length){
      var col=document.createElement("div"); col.className="bcol";
      col.innerHTML='<div class="bptrs"></div><div class="bar"></div><div class="bval"></div><div class="bidx"></div>';
      row.appendChild(col); host._cols.push(col);
    }
    while(host._cols.length>bars.length){ var c=host._cols.pop(); if(c.parentNode)c.parentNode.removeChild(c); }
    bars.forEach(function(b,i){
      var col=host._cols[i];
      col.className="bcol"+(b.cls?(" "+b.cls):"");
      var bar=col.querySelector(".bar"); bar.style.height=Math.round(12+(PLOT-12)*(b.val/maxV))+"px";
      col.querySelector(".bval").textContent=b.val;
      col.querySelector(".bidx").textContent=i;
      // pointer tags (stacked)
      var host2=col.querySelector(".bptrs"); host2.innerHTML="";
      (b.ptrs||[]).forEach(function(lbl,k){
        var t=document.createElement("span"); t.className="bptr"; t.textContent=lbl;
        t.style.setProperty("--pc", PTR_COLOR[lbl]||"var(--stamp)"); t.style.top=(-24-k*20)+"px";
        host2.appendChild(t);
      });
    });
  }

  function play(cfg){
    injectCSS();
    var host=cfg.host, frames=cfg.frames, i=0, timer=null, playing=false, bPlay, lbl;
    function draw(){ var f=frames[i]; render(host, f);
      if(cfg.narrEl) cfg.narrEl.textContent=f.narr||"";
      if(cfg.codeHost) renderCode(cfg.codeHost, f.codeLines||cfg.code, f.code);
      if(lbl) lbl.textContent=(i+1)+" / "+frames.length; }
    function go(n){ i=((n%frames.length)+frames.length)%frames.length; draw(); }
    function start(){ playing=true; if(timer) clearInterval(timer); timer=setInterval(function(){ go(i+1); }, cfg.ms||1400); if(bPlay) bPlay.textContent="Pause"; }
    function stop(){ playing=false; if(timer){ clearInterval(timer); timer=null; } if(bPlay) bPlay.textContent="Play"; }
    var bar=document.createElement("div"); bar.className="bars-ctrls";
    var bPrev=cbtn("◀ Back","Previous step"); bPlay=cbtn("Pause","Play or pause"); var bNext=cbtn("Step ▶","Next step");
    lbl=document.createElement("span"); lbl.className="bars-step";
    bPrev.onclick=function(){ stop(); go(i-1); };
    bNext.onclick=function(){ stop(); go(i+1); };
    bPlay.onclick=function(){ if(playing) stop(); else start(); };
    bar.appendChild(bPrev); bar.appendChild(bPlay); bar.appendChild(bNext); bar.appendChild(lbl);
    var stage=host.parentNode; if(stage && stage.parentNode) stage.parentNode.insertBefore(bar, stage.nextSibling);
    draw(); start();
    return { stop:stop, start:start, go:go };
  }

  window.BarsAnim={ play:play, render:render, renderCode:renderCode, injectCSS:injectCSS };
})(window);
