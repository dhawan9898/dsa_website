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

  var PTR_COLOR={ HEAD:"var(--stamp)", cur:"var(--plot)", prev:"var(--seal)",
                  target:"var(--stamp)", tail:"var(--plot)", "n":"var(--seal)" };

  function slotX(col){ return PADX + col*COLW; }
  function slotY(row){ return PADY + row*ROWH; }

  /* ---- code panel (line-numbered C, active line highlighted) ---- */
  function lineSet(cl){
    if(cl==null) return [];
    if(typeof cl==="number") return [cl];
    var a=[]; for(var i=cl[0];i<=cl[1];i++) a.push(i); return a;
  }
  function renderCode(host, lines, cl){
    if(!host) return;
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
        box.className="ll-node";
        box.innerHTML='<div class="ll-val"></div><div class="ll-nextcell"><span class="ll-dot"></span></div>';
        box.style.left=x+"px"; box.style.top=y+"px";
        host.appendChild(box);
        box._pop=true;               // entrance animation on first show
        nodes[n.id]=box;
      }
      box.style.left=x+"px"; box.style.top=y+"px";
      var valEl=box.firstChild;
      var newVal=(n.val==null||n.val==="")?"":String(n.val);
      if(valEl.textContent!==newVal){
        valEl.textContent=newVal;
        if(newVal!==""){ valEl.classList.remove("fill"); void valEl.offsetWidth; valEl.classList.add("fill"); }
      }
      valEl.classList.toggle("empty", newVal==="");
      var cls="ll-node"+(n.cls?(" "+n.cls):"");
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
      (n.ptrs||[]).forEach(function(lbl){
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
        tag.style.top=(y-30)+"px";
      });
    });
    Object.keys(ptrs).forEach(function(lbl){
      if(!seenPtr[lbl]){ var t=ptrs[lbl]; if(t.parentNode) t.parentNode.removeChild(t); delete ptrs[lbl]; }
    });

    /* arrows (redraw every frame) */
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    ensureDefs(svg);
    frame.nodes.forEach(function(n){
      if(n.next===undefined) return;
      var x=slotX(n.col), y=slotY(n.row);
      var sx=x+NW-14, sy=y+NH/2;                 // start: the next-cell dot
      var ex, ey, targetNull=(n.next==="null");
      if(targetNull){ ex=x+NW+30; ey=sy; }
      else{
        var t=byId[n.next]; if(!t) return;
        var tx=slotX(t.col), ty=slotY(t.row);
        ex=tx-4; ey=ty+NH/2;
      }
      drawArrow(svg, sx, sy, ex, ey, n.nextCls, targetNull);
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
    var host=cfg.host, svg=cfg.svg, i=0;
    function step(){
      var f=cfg.frames[i];
      render(host, svg, f);
      if(cfg.narrEl) cfg.narrEl.textContent=f.narr||"";
      if(cfg.codeHost) renderCode(cfg.codeHost, cfg.code, f.code);
      i=(i+1)%cfg.frames.length;
    }
    step();
    var timer=setInterval(step, cfg.ms||1600);
    return { stop:function(){ clearInterval(timer); } };
  }

  window.LLAnim={ play:play, render:render, renderCode:renderCode };

})(window);
