/* ==========================================================================
   LLAnim — a step-at-a-time linked-list "mechanism" renderer.

   Unlike DSRender.sequence (which draws a finished chain), this renderer is
   built to show a linked list being BUILT and REWIRED one C statement at a
   time: a node box appears empty, its value fills in, its next arrow draws to
   a target, and pointer tags (HEAD / cur / prev …) glide from node to node.

   It keeps DOM elements PERSISTENT across frames (keyed by node id and by
   pointer label) so CSS transitions can animate movement, instead of the
   full-redraw approach the other renderers use. Positions are computed from
   each node's {row, col} grid slot — never measured — so arrows never depend
   on layout timing.

   A frame is a whole-scene snapshot:
     {
       nodes: [ { id,               // stable identity across frames
                  val,              // value, or null/"" for an empty box
                  row, col,         // grid slot (col may be fractional)
                  cls,              // extra classes: "active" "target" "dim" "gone"
                  ptrs,             // pointer tags above it, e.g. ["HEAD","cur"]
                  next,             // id of the node its next points to,
                                    //   "null" for a NULL terminator, or
                                    //   undefined to draw no arrow yet
                  nextCls } ],      // arrow state: "active" (changing) | "formed" (new)
       code,                        // 0-based line index, or [start,end]
       narr                         // narration sentence
     }

   API:
     LLAnim.play({ host, svg, narrEl, codeHost, code, frames, ms })
       Loops `frames`, rendering the scene into `host` (+ arrow `svg`),
       narration into `narrEl`, and the C code into `codeHost` (optional).
       Returns { stop }.
     LLAnim.render(host, svg, frame)   — draw one frame (no loop).
     LLAnim.renderCode(codeHost, code, codeLine)
   ========================================================================== */
(function(window){
  "use strict";

  var NW=88, NH=48, COLW=140, ROWH=120, PADX=58, PADY=52;

  var PTR_COLOR={ HEAD:"var(--stamp)", TAIL:"var(--plot)", cur:"var(--plot)", prev:"var(--seal)",
                  target:"var(--stamp)", tail:"var(--plot)", "n":"var(--seal)" };

  function slotX(col){ return PADX + col*COLW; }
  function slotY(row){ return PADY + row*ROWH; }

  /* Inject our own stylesheet so the boxes never depend on a (possibly
     browser-cached) theme.css. This file is the single source of truth for
     the LLAnim visuals. Runs once. */
  var cssInjected=false;
  function injectCSS(){
    if(cssInjected) return; cssInjected=true;
    var css=[
      ".ll-stage{position:relative;overflow-x:auto;overflow-y:hidden;padding:6px 0 2px}",
      ".ll-stage .ll-svg{position:absolute;left:0;top:0;pointer-events:none;z-index:1}",
      ".ll-node{position:absolute;display:flex;width:88px;height:48px;z-index:2;transition:left .5s var(--ease,ease),top .5s var(--ease,ease),opacity .4s var(--ease,ease),transform .4s var(--ease,ease)}",
      ".ll-node .ll-val{flex:1 1 auto;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:17px;color:var(--ink,#1C2B24);background:#fff;border:2px solid var(--ink,#1C2B24);border-right:none;border-radius:6px 0 0 6px}",
      ".ll-node .ll-val.empty{color:transparent;background:repeating-linear-gradient(45deg,#fff,#fff 5px,#eef2e6 5px,#eef2e6 10px)}",
      ".ll-node .ll-val.fill{animation:llfill .5s var(--ease,ease)}",
      ".ll-node .ll-nextcell{flex:0 0 26px;display:flex;align-items:center;justify-content:center;background:#F4F7EE;border:2px solid var(--ink,#1C2B24);border-radius:0 6px 6px 0}",
      ".ll-node .ll-dot{width:9px;height:9px;border-radius:50%;background:var(--ink,#1C2B24)}",
      ".ll-node.dbl .ll-val{flex:1 1 auto;border-left:none;border-right:none;border-radius:0}",
      ".ll-node.dbl .ll-prevcell{flex:0 0 22px;display:flex;align-items:center;justify-content:center;background:#F4F7EE;border:2px solid var(--ink,#1C2B24);border-right:none;border-radius:6px 0 0 6px}",
      ".ll-node.dbl .ll-nextcell{flex:0 0 22px}",
      ".ll-node.dbl.active .ll-prevcell{border-color:var(--stamp,#BE3A1D)}",
      ".ll-node.dbl.target .ll-prevcell{border-color:var(--plot,#1F4E79)}",
      ".ll-node.dbl.found .ll-prevcell{border-color:var(--seal,#2E6B4F)}",
      ".ll-node.pop{animation:llpop .45s var(--ease,ease)}",
      ".ll-node.gone{opacity:0;transform:translateY(14px) scale(.9)}",
      ".ll-node.active .ll-val,.ll-node.active .ll-nextcell{border-color:var(--stamp,#BE3A1D)}",
      ".ll-node.active .ll-dot{background:var(--stamp,#BE3A1D)}",
      ".ll-node.active .ll-val{color:var(--stamp,#BE3A1D)}",
      ".ll-node.target .ll-val,.ll-node.target .ll-nextcell{border-color:var(--plot,#1F4E79)}",
      ".ll-node.target .ll-dot{background:var(--plot,#1F4E79)}",
      ".ll-node.found .ll-val,.ll-node.found .ll-nextcell{border-color:var(--seal,#2E6B4F)}",
      ".ll-node.found .ll-val{color:var(--seal,#2E6B4F)}",
      ".ll-node.dim{opacity:.4}",
      ".ll-ptr{position:absolute;z-index:3;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;transition:left .5s var(--ease,ease),top .5s var(--ease,ease)}",
      ".ll-ptr .ll-ptr-lbl{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;letter-spacing:.03em;color:#fff;background:var(--pc,#BE3A1D);padding:2px 7px;border-radius:4px;white-space:nowrap}",
      ".ll-ptr .ll-ptr-stem{width:2px;height:12px;background:var(--pc,#BE3A1D)}",
      ".ll-arrow{stroke:var(--ink-soft,#5D6E61);stroke-width:2.2;transition:d .4s var(--ease,ease)}",
      ".ll-arrow.active{stroke:var(--stamp,#BE3A1D);stroke-width:2.8}",
      ".ll-arrow.formed{stroke:var(--seal,#2E6B4F);stroke-width:2.8}",
      ".llhead{fill:var(--ink-soft,#5D6E61)} .llhead.active{fill:var(--stamp,#BE3A1D)} .llhead.formed{fill:var(--seal,#2E6B4F)}",
      ".ll-null{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;fill:var(--ink-soft,#5D6E61)}",
      ".ll-ctrls{display:flex;align-items:center;gap:7px;margin:10px 0 2px;flex-wrap:wrap}",
      ".ll-cbtn{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:14px;line-height:1;padding:7px 13px;border:1px solid var(--ink,#1C2B24);background:#F4F7EE;color:var(--ink,#1C2B24);border-radius:5px;cursor:pointer}",
      ".ll-cbtn:hover{background:var(--ink,#1C2B24);color:var(--paper,#EAEFE2)}",
      ".ll-step{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-soft,#5D6E61);margin-left:6px}",
      "@keyframes llpop{0%{opacity:0;transform:scale(.6) translateY(10px)}100%{opacity:1;transform:none}}",
      "@keyframes llfill{0%{transform:scale(1.5);color:var(--seal,#2E6B4F)}100%{transform:scale(1);color:var(--ink,#1C2B24)}}"
    ].join("\n");
    var s=document.createElement("style"); s.setAttribute("data-ll-anim","1");
    s.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(s);
  }
  function cbtn(txt,label){
    var b=document.createElement("button"); b.type="button"; b.className="ll-cbtn";
    b.textContent=txt; b.setAttribute("aria-label",label); return b;
  }

  /* ---- code panel (line-numbered C, active line highlighted) ---- */
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

  /* ---- one scene render (reusing persistent elements) ---- */
  function render(host, svg, frame){
    injectCSS();
    if(!host._nodes) host._nodes={};
    if(!host._ptrs) host._ptrs={};
    var nodes=host._nodes, ptrs=host._ptrs;

    var maxRow=0, maxCol=0;
    frame.nodes.forEach(function(n){ if(n.row>maxRow)maxRow=n.row; if(n.col>maxCol)maxCol=n.col; });
    var W=slotX(maxCol)+NW+82, H=slotY(maxRow)+NH+26;
    host.style.position="relative";
    host.style.minWidth=W+"px";
    host.style.height=H+"px";
    svg.setAttribute("viewBox","0 0 "+W+" "+H);
    svg.style.width=W+"px"; svg.style.height=H+"px";

    var seen={}, seenPtr={};

    /* nodes */
    frame.nodes.forEach(function(n){
      seen[n.id]=true;
      var x=slotX(n.col), y=slotY(n.row);
      var box=nodes[n.id];
      if(!box){
        box=document.createElement("div");
        box.className="ll-node"+(frame.double?" dbl":"");
        box.innerHTML = frame.double
          ? '<div class="ll-prevcell"><span class="ll-dot"></span></div><div class="ll-val"></div><div class="ll-nextcell"><span class="ll-dot"></span></div>'
          : '<div class="ll-val"></div><div class="ll-nextcell"><span class="ll-dot"></span></div>';
        box.style.left=x+"px"; box.style.top=y+"px";
        host.appendChild(box);
        box._pop=true;               // entrance animation on first show
        nodes[n.id]=box;
      }
      box.style.left=x+"px"; box.style.top=y+"px";
      var valEl=box.querySelector(".ll-val");
      var newVal=(n.val==null||n.val==="")?"":String(n.val);
      if(valEl.textContent!==newVal){
        valEl.textContent=newVal;
        if(newVal!==""){ valEl.classList.remove("fill"); void valEl.offsetWidth; valEl.classList.add("fill"); }
      }
      valEl.classList.toggle("empty", newVal==="");
      var cls="ll-node"+(frame.double?" dbl":"")+(n.cls?(" "+n.cls):"");
      if(box._pop){ cls+=" pop"; box._pop=false; }
      box.className=cls;
    });

    /* remove nodes no longer present (fade + drop) */
    Object.keys(nodes).forEach(function(id){
      if(!seen[id]){
        var box=nodes[id];
        box.classList.add("gone");
        (function(b){ setTimeout(function(){ if(b.parentNode) b.parentNode.removeChild(b); },420); })(box);
        delete nodes[id];
      }
    });

    /* pointer tags (persistent per label so they glide when they move) */
    var byId={}; frame.nodes.forEach(function(n){ byId[n.id]=n; });
    frame.nodes.forEach(function(n){
      (n.ptrs||[]).forEach(function(lbl,k){
        seenPtr[lbl]=true;
        var tag=ptrs[lbl];
        if(!tag){
          tag=document.createElement("div"); tag.className="ll-ptr";
          tag.innerHTML='<span class="ll-ptr-lbl"></span><span class="ll-ptr-stem"></span>';
          tag.firstChild.textContent=lbl;
          host.appendChild(tag); ptrs[lbl]=tag;
        }
        var col=PTR_COLOR[lbl]||"var(--stamp)";
        tag.style.setProperty("--pc", col);
        var x=slotX(n.col), y=slotY(n.row);
        tag.style.left=(x+NW/2)+"px";
        tag.style.top=(y-30-k*22)+"px";   // stack multiple tags on one node
      });
    });
    Object.keys(ptrs).forEach(function(lbl){
      if(!seenPtr[lbl]){ var t=ptrs[lbl]; if(t.parentNode) t.parentNode.removeChild(t); delete ptrs[lbl]; }
    });

    /* arrows (redraw every frame) */
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    ensureDefs(svg);
    var dbl=frame.double;
    frame.nodes.forEach(function(n){
      var x=slotX(n.col), y=slotY(n.row);
      // next arrow — points right (upper band in double mode, middle otherwise)
      if(n.next!==undefined){
        var sy=dbl?(y+14):(y+NH/2), sx=x+NW-14, ex, ey, targetNull=(n.next==="null");
        if(targetNull){ ex=x+NW+30; ey=sy; }
        else{ var t=byId[n.next]; if(t){ ex=slotX(t.col)-4; ey=dbl?(slotY(t.row)+14):(slotY(t.row)+NH/2); } else ex=null; }
        if(ex!==null) drawArrow(svg, sx, sy, ex, ey, n.nextCls, targetNull);
      }
      // prev arrow — points left (lower band); double mode only
      if(dbl && n.prev!==undefined){
        var syB=y+NH-14, sxB=x+14, exB, eyB, prevNull=(n.prev==="null");
        if(prevNull){ exB=x-30; eyB=syB; }
        else{ var tp=byId[n.prev]; if(tp){ exB=slotX(tp.col)+NW+4; eyB=slotY(tp.row)+NH-14; } else exB=null; }
        if(exB!==null) drawArrow(svg, sxB, syB, exB, eyB, n.prevCls, prevNull);
      }
    });
  }

  function ensureDefs(svg){
    var ns="http://www.w3.org/2000/svg";
    var defs=document.createElementNS(ns,"defs");
    ["gray","active","formed"].forEach(function(kind){
      var m=document.createElementNS(ns,"marker");
      m.setAttribute("id","llhead-"+kind);
      m.setAttribute("markerWidth","9"); m.setAttribute("markerHeight","9");
      m.setAttribute("refX","7"); m.setAttribute("refY","3");
      m.setAttribute("orient","auto"); m.setAttribute("markerUnits","userSpaceOnUse");
      var p=document.createElementNS(ns,"path");
      p.setAttribute("d","M0,0 L7,3 L0,6 Z");
      p.setAttribute("class","llhead "+kind);
      m.appendChild(p); defs.appendChild(m);
    });
    svg.appendChild(defs);
  }

  function drawArrow(svg, sx, sy, ex, ey, state, isNull){
    var ns="http://www.w3.org/2000/svg";
    var kind = state==="active"?"active":(state==="formed"?"formed":"gray");
    var path=document.createElementNS(ns,"path");
    var d;
    if(Math.abs(sy-ey)<2){                       // same row: straight
      d="M"+sx+","+sy+" L"+(ex-2)+","+ey;
    }else{                                        // different rows: smooth curve
      var mx=(sx+ex)/2;
      d="M"+sx+","+sy+" C"+mx+","+sy+" "+mx+","+ey+" "+(ex-2)+","+ey;
    }
    path.setAttribute("d",d);
    path.setAttribute("class","ll-arrow "+kind);
    path.setAttribute("fill","none");
    path.setAttribute("marker-end","url(#llhead-"+kind+")");
    svg.appendChild(path);
    if(isNull){                                   // NULL glyph at the arrow end
      var t=document.createElementNS(ns,"text");
      t.setAttribute("x",ex+4); t.setAttribute("y",ey+4);
      t.setAttribute("class","ll-null");
      t.textContent="NULL";
      svg.appendChild(t);
    }
  }

  function play(cfg){
    injectCSS();
    var host=cfg.host, svg=cfg.svg, frames=cfg.frames, i=0, timer=null, playing=false, bPlay, lbl;
    function draw(){
      var f=frames[i];
      render(host, svg, f);
      if(cfg.narrEl) cfg.narrEl.textContent=f.narr||"";
      if(cfg.codeHost) renderCode(cfg.codeHost, cfg.code, f.code);
      if(lbl) lbl.textContent=(i+1)+" / "+frames.length;
    }
    function go(n){ i=((n%frames.length)+frames.length)%frames.length; draw(); }
    function start(){ playing=true; if(timer) clearInterval(timer);
      timer=setInterval(function(){ go(i+1); }, cfg.ms||1900); if(bPlay) bPlay.textContent="Pause"; }
    function stop(){ playing=false; if(timer){ clearInterval(timer); timer=null; } if(bPlay) bPlay.textContent="Play"; }

    var bar=document.createElement("div"); bar.className="ll-ctrls";
    var bPrev=cbtn("◀ Back","Previous step");
    bPlay=cbtn("Pause","Play or pause");
    var bNext=cbtn("Step ▶","Next step");
    lbl=document.createElement("span"); lbl.className="ll-step";
    bPrev.onclick=function(){ stop(); go(i-1); };
    bNext.onclick=function(){ stop(); go(i+1); };
    bPlay.onclick=function(){ if(playing) stop(); else start(); };
    bar.appendChild(bPrev); bar.appendChild(bPlay); bar.appendChild(bNext); bar.appendChild(lbl);
    var stage=host.parentNode;
    if(stage && stage.parentNode) stage.parentNode.insertBefore(bar, stage.nextSibling);

    draw();
    start();
    return { stop:stop, start:start, go:go };
  }

  window.LLAnim={ play:play, render:render, renderCode:renderCode, injectCSS:injectCSS };

})(window);
