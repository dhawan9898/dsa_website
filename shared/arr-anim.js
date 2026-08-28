/* ==========================================================================
   ArrAnim — a step-at-a-time renderer for fixed-slot array structures.

   Sibling of LLAnim (shared/ll-anim.js), same philosophy: show a structure
   being built and changed ONE C statement at a time. Where LLAnim draws a
   linked chain with next-arrows, ArrAnim draws a fixed array of numbered
   slots — the mental model behind an array-backed stack, queue, circular
   queue, and deque. Empty slots are hatched; occupied slots hold a value;
   pointer tags (TOP / FRONT / REAR …) sit beside a slot and GLIDE to a new
   slot when the index moves, which is exactly what `++top` / `rear = (rear+1)`
   look like.

   Positions are computed from each slot's fixed index (never measured), so
   nothing depends on layout timing and pointer tags can transition smoothly.

   A frame is a whole snapshot:
     {
       slots: [ { val, cls, ptrs } , ... ],   // one entry per capacity slot,
                                               //   in index order 0..N-1.
                                               //   val null/"" => empty (hatched)
                                               //   cls: "active" "found" "target" "dim"
                                               //   ptrs: ["TOP"] etc (tags on this slot)
       dir: "v" | "h",     // "v": index 0 at the BOTTOM (a stack grows up).
                           // "h": index 0 at the LEFT (a queue runs rightward).
       note,               // optional small caption drawn under the slots
       code,               // 0-based line index, or [start,end]
       narr                // narration sentence
     }

   API mirrors LLAnim:
     ArrAnim.play({ host, narrEl, codeHost, code, frames, ms })  -> {stop,start,go}
     ArrAnim.render(host, frame)
     ArrAnim.renderCode(codeHost, lines, codeLine)
     ArrAnim.injectCSS()
   ========================================================================== */
(function(window){
  "use strict";

  var BW=104, BH=42, VGAP=8, HGAP=20, PADX=46, PADY=44;
  var PTR_COLOR={ TOP:"var(--stamp)", FRONT:"var(--plot)", REAR:"var(--seal)",
                  HEAD:"var(--stamp)", TAIL:"var(--plot)", i:"var(--plot)" };

  /* ---- code panel (shared shape with LLAnim / the engines) ---- */
  function lineSet(cl){
    if(cl==null) return [];
    if(typeof cl==="number") return [cl];
    var a=[]; for(var i=cl[0];i<=cl[1];i++) a.push(i); return a;
  }
  function renderCode(host, lines, cl){
    if(!host) return;
    if(!lines){ host.innerHTML=""; host._els=null; host._src=null; return; }
    if(!host._els || host._src!==lines){
      host.innerHTML=""; host._els=[]; host._src=lines;
      lines.forEach(function(src,i){
        var d=document.createElement("div"); d.className="code-line";
        d.innerHTML='<span class="code-ln">'+(i+1)+'</span><span class="code-src"></span>';
        d.lastChild.textContent=src;
        host.appendChild(d); host._els.push(d);
      });
    }
    var set=lineSet(cl);
    host._els.forEach(function(el,j){ el.className="code-line"+(set.indexOf(j)>=0?" active":""); });
  }

  var cssInjected=false;
  function injectCSS(){
    if(cssInjected) return; cssInjected=true;
    var css=[
      ".arr-stage{position:relative;overflow:auto;padding:6px 0 2px}",
      ".arr-slot{position:absolute;display:flex;align-items:center;justify-content:center;width:104px;height:42px;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:17px;color:var(--ink,#1C2B24);background:#fff;border:2px solid var(--ink,#1C2B24);border-radius:6px;transition:left .45s var(--ease,ease),top .45s var(--ease,ease),opacity .4s var(--ease,ease),transform .4s var(--ease,ease),border-color .3s var(--ease,ease),background .3s var(--ease,ease)}",
      ".arr-slot.empty{color:transparent;background:repeating-linear-gradient(45deg,#fff,#fff 6px,#eef2e6 6px,#eef2e6 12px);border-style:dashed;border-color:var(--rule,#A8B7A3)}",
      ".arr-slot.fill{animation:arrfill .5s var(--ease,ease)}",
      ".arr-slot.pop{animation:arrpop .45s var(--ease,ease)}",
      ".arr-slot.gone{opacity:0;transform:scale(.85)}",
      ".arr-slot.active{border-color:var(--stamp,#BE3A1D);color:var(--stamp,#BE3A1D)}",
      ".arr-slot.found{border-color:var(--seal,#2E6B4F);color:var(--seal,#2E6B4F)}",
      ".arr-slot.target{border-color:var(--plot,#1F4E79);color:var(--plot,#1F4E79)}",
      ".arr-slot.dim{opacity:.4}",
      ".arr-idx{position:absolute;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-soft,#5D6E61)}",
      ".arr-ptr{position:absolute;z-index:3;display:flex;align-items:center;transition:left .45s var(--ease,ease),top .45s var(--ease,ease)}",
      ".arr-ptr .arr-ptr-lbl{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;color:#fff;background:var(--pc,#BE3A1D);padding:2px 7px;border-radius:4px;white-space:nowrap}",
      ".arr-note{position:absolute;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-soft,#5D6E61)}",
      ".arr-ctrls{display:flex;align-items:center;gap:7px;margin:10px 0 2px;flex-wrap:wrap}",
      ".arr-cbtn{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:14px;line-height:1;padding:7px 13px;border:1px solid var(--ink,#1C2B24);background:#F4F7EE;color:var(--ink,#1C2B24);border-radius:5px;cursor:pointer}",
      ".arr-cbtn:hover{background:var(--ink,#1C2B24);color:var(--paper,#EAEFE2)}",
      ".arr-step{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-soft,#5D6E61);margin-left:6px}",
      "@keyframes arrpop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}",
      "@keyframes arrfill{0%{transform:scale(1.4);color:var(--seal,#2E6B4F)}100%{transform:scale(1);color:var(--ink,#1C2B24)}}"
    ].join("\n");
    var s=document.createElement("style"); s.setAttribute("data-arr-anim","1");
    s.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(s);
  }
  function cbtn(txt,label){
    var b=document.createElement("button"); b.type="button"; b.className="arr-cbtn";
    b.textContent=txt; b.setAttribute("aria-label",label); return b;
  }

  function render(host, frame){
    injectCSS();
    if(!host._slots) host._slots={};
    if(!host._idx) host._idx={};
    if(!host._ptrs) host._ptrs={};
    var slots=host._slots, idxEls=host._idx, ptrs=host._ptrs;
    var n=frame.slots.length, dir=frame.dir||"v";

    // geometry per slot index
    function pos(i){
      if(dir==="v") return { x:PADX, y:(n-1-i)*(BH+VGAP) };
      return { x:PADX+i*(BW+HGAP), y:PADY };
    }
    var W, H;
    if(dir==="v"){ W=PADX+BW+60; H=n*(BH+VGAP); }
    else{ W=PADX+n*(BW+HGAP)+10; H=PADY+BH+34; }
    host.style.position="relative"; host.style.minWidth=W+"px"; host.style.height=H+"px";

    var seen={}, seenPtr={};
    frame.slots.forEach(function(sl,i){
      seen[i]=true;
      var p=pos(i), box=slots[i];
      if(!box){
        box=document.createElement("div"); box.className="arr-slot";
        box.style.left=p.x+"px"; box.style.top=p.y+"px";
        host.appendChild(box); box._pop=true; slots[i]=box;
        // index label
        var il=document.createElement("div"); il.className="arr-idx"; il.textContent=i;
        if(dir==="v"){ il.style.left=(p.x-22)+"px"; il.style.top=(p.y+13)+"px"; }
        else{ il.style.left=(p.x+BW/2-4)+"px"; il.style.top=(p.y+BH+6)+"px"; }
        host.appendChild(il); idxEls[i]=il;
      }
      box.style.left=p.x+"px"; box.style.top=p.y+"px";
      var newVal=(sl.val==null||sl.val==="")?"":String(sl.val);
      if(box.textContent!==newVal){
        box.textContent=newVal;
        if(newVal!==""){ box.classList.remove("fill"); void box.offsetWidth; box.classList.add("fill"); }
      }
      var cls="arr-slot"+(newVal===""?" empty":"")+(sl.cls?(" "+sl.cls):"");
      if(box._pop){ cls+=" pop"; box._pop=false; }
      box.className=cls;
    });
    Object.keys(slots).forEach(function(k){
      if(!seen[k]){ if(slots[k].parentNode) slots[k].parentNode.removeChild(slots[k]);
        if(idxEls[k] && idxEls[k].parentNode) idxEls[k].parentNode.removeChild(idxEls[k]);
        delete slots[k]; delete idxEls[k]; }
    });

    // pointer tags (persistent per label, glide)
    frame.slots.forEach(function(sl,i){
      (sl.ptrs||[]).forEach(function(lbl){
        seenPtr[lbl]=true;
        var tag=ptrs[lbl];
        if(!tag){ tag=document.createElement("div"); tag.className="arr-ptr";
          tag.innerHTML='<span class="arr-ptr-lbl"></span>'; tag.firstChild.textContent=lbl;
          host.appendChild(tag); ptrs[lbl]=tag; }
        tag.style.setProperty("--pc", PTR_COLOR[lbl]||"var(--stamp)");
        var p=pos(i);
        if(dir==="v"){ tag.style.left=(p.x+BW+8)+"px"; tag.style.top=(p.y+10)+"px"; }
        else{ tag.style.left=(p.x+BW/2-16)+"px"; tag.style.top=(p.y-26)+"px"; }
      });
    });
    Object.keys(ptrs).forEach(function(lbl){
      if(!seenPtr[lbl]){ if(ptrs[lbl].parentNode) ptrs[lbl].parentNode.removeChild(ptrs[lbl]); delete ptrs[lbl]; }
    });

    // optional caption
    if(!host._note){ var nn=document.createElement("div"); nn.className="arr-note"; host.appendChild(nn); host._note=nn; }
    host._note.textContent=frame.note||"";
    if(dir==="v"){ host._note.style.left=(PADX+BW+8)+"px"; host._note.style.top=(H-20)+"px"; }
    else{ host._note.style.left=PADX+"px"; host._note.style.top=(PADY-30)+"px"; }
  }

  function play(cfg){
    injectCSS();
    var host=cfg.host, frames=cfg.frames, i=0, timer=null, playing=false, bPlay, lbl;
    function draw(){
      var f=frames[i];
      render(host, f);
      if(cfg.narrEl) cfg.narrEl.textContent=f.narr||"";
      if(cfg.codeHost) renderCode(cfg.codeHost, f.codeLines||cfg.code, f.code);
      if(lbl) lbl.textContent=(i+1)+" / "+frames.length;
    }
    function go(n){ i=((n%frames.length)+frames.length)%frames.length; draw(); }
    function start(){ playing=true; if(timer) clearInterval(timer);
      timer=setInterval(function(){ go(i+1); }, cfg.ms||1900); if(bPlay) bPlay.textContent="Pause"; }
    function stop(){ playing=false; if(timer){ clearInterval(timer); timer=null; } if(bPlay) bPlay.textContent="Play"; }
    var bar=document.createElement("div"); bar.className="arr-ctrls";
    var bPrev=cbtn("◀ Back","Previous step"); bPlay=cbtn("Pause","Play or pause");
    var bNext=cbtn("Step ▶","Next step");
    lbl=document.createElement("span"); lbl.className="arr-step";
    bPrev.onclick=function(){ stop(); go(i-1); };
    bNext.onclick=function(){ stop(); go(i+1); };
    bPlay.onclick=function(){ if(playing) stop(); else start(); };
    bar.appendChild(bPrev); bar.appendChild(bPlay); bar.appendChild(bNext); bar.appendChild(lbl);
    var stage=host.parentNode;
    if(stage && stage.parentNode) stage.parentNode.insertBefore(bar, stage.nextSibling);
    draw(); start();
    return { stop:stop, start:start, go:go };
  }

  window.ArrAnim={ play:play, render:render, renderCode:renderCode, injectCSS:injectCSS };

})(window);
