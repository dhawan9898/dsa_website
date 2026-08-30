/* ==========================================================================
   TreeAnim — a step-at-a-time renderer for binary trees.

   Tree-world sibling of LLAnim / ArrAnim. Draws a binary tree one C step at a
   time: nodes are persistent id-keyed boxes positioned by an in-order layout
   (x = in-order rank, y = depth), so when the structure changes — a new leaf,
   a rotation — nodes GLIDE to their new positions and the edges follow them
   (edges are redrawn from measured node centers across the transition, which
   is what makes an AVL rotation read as a smooth pivot).

   A frame is a whole-tree snapshot:
     {
       root: id | null,
       nodes: { id: { val, left, right, cls } , ... },  // adjacency by child id
       ptrs:  { id: [labels] },      // pointer tags on nodes (e.g. ["cur"])
       edgeCls: { "parent>child": "active" },  // optional edge highlight
       code, narr
     }
   cls on a node: "active" (red) | "target" (blue) | "found" (green) | "dim".

   API mirrors the others:
     TreeAnim.play({ host, svg, narrEl, codeHost, code, frames, ms }) -> {stop,start,go}
     TreeAnim.render(host, svg, frame)
     TreeAnim.renderCode(host, lines, codeLine)
     TreeAnim.injectCSS()
   ========================================================================== */
(function(window){
  "use strict";
  var NS="http://www.w3.org/2000/svg";
  var NW=48, NH=44, HGAP=60, VGAP=76, PADX=30, PADY=34;
  var PTR_COLOR={ cur:"var(--plot)", ins:"var(--stamp)", node:"var(--stamp)", parent:"var(--seal)" };

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
      ".tree-stage{position:relative;overflow:auto}",
      ".tree-stage .tree-svg{position:absolute;left:0;top:0;pointer-events:none;z-index:1}",
      ".tree-node{position:absolute;width:48px;height:44px;display:flex;align-items:center;justify-content:center;z-index:2;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:16px;color:var(--ink,#1C2B24);background:#fff;border:2px solid var(--ink,#1C2B24);border-radius:9px;transition:left .45s var(--ease,ease),top .45s var(--ease,ease),opacity .4s var(--ease,ease),transform .4s var(--ease,ease),border-color .3s var(--ease,ease),background .3s var(--ease,ease)}",
      ".tree-node.active{border-color:var(--stamp,#BE3A1D);color:var(--stamp,#BE3A1D)}",
      ".tree-node.target{border-color:var(--plot,#1F4E79);color:var(--plot,#1F4E79)}",
      ".tree-node.found{border-color:var(--seal,#2E6B4F);color:var(--seal,#2E6B4F);background:rgba(46,107,79,.09)}",
      ".tree-node.dim{opacity:.4}",
      ".tree-node.pop{animation:treepop .42s var(--ease,ease)}",
      ".tree-node.gone{opacity:0;transform:scale(.8)}",
      ".tree-node.fill{animation:treefill .5s var(--ease,ease)}",
      ".tree-edge{stroke:var(--ink-soft,#5D6E61);stroke-width:2;fill:none}",
      ".tree-edge.active{stroke:var(--stamp,#BE3A1D);stroke-width:2.6}",
      ".tree-edge.formed{stroke:var(--seal,#2E6B4F);stroke-width:2.6}",
      ".tree-ptr{position:absolute;z-index:3;transition:left .45s var(--ease,ease),top .45s var(--ease,ease)}",
      ".tree-ptr .tree-ptr-lbl{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;color:#fff;background:var(--pc,#1F4E79);padding:2px 6px;border-radius:4px;white-space:nowrap}",
      ".tree-ctrls{display:flex;align-items:center;gap:7px;margin:10px 0 2px;flex-wrap:wrap}",
      ".tree-cbtn{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:14px;line-height:1;padding:7px 13px;border:1px solid var(--ink,#1C2B24);background:#F4F7EE;color:var(--ink,#1C2B24);border-radius:5px;cursor:pointer}",
      ".tree-cbtn:hover{background:var(--ink,#1C2B24);color:var(--paper,#EAEFE2)}",
      ".tree-step{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-soft,#5D6E61);margin-left:6px}",
      "@keyframes treepop{0%{opacity:0;transform:scale(.5)}100%{opacity:1;transform:none}}",
      "@keyframes treefill{0%{transform:scale(1.4);color:var(--seal,#2E6B4F)}100%{transform:scale(1);color:var(--ink,#1C2B24)}}"
    ].join("\n");
    var s=document.createElement("style"); s.setAttribute("data-tree-anim","1");
    s.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(s);
  }
  function cbtn(txt,label){ var b=document.createElement("button"); b.type="button"; b.className="tree-cbtn"; b.textContent=txt; b.setAttribute("aria-label",label); return b; }

  function layout(frame){
    var pos={}, idx={v:0};
    function rec(id, depth){
      if(id==null || id==="null" || !frame.nodes[id]) return;
      var n=frame.nodes[id];
      rec(n.left, depth+1);
      pos[id]={ col: idx.v++, depth: depth };
      rec(n.right, depth+1);
    }
    rec(frame.root, 0);
    return pos;
  }

  function render(host, svg, frame){
    injectCSS();
    if(!host._nodes) host._nodes={};
    if(!host._ptrs) host._ptrs={};
    var nodesEl=host._nodes, ptrs=host._ptrs;
    var pos=layout(frame);
    var maxCol=0, maxDepth=0;
    Object.keys(pos).forEach(function(id){ if(pos[id].col>maxCol)maxCol=pos[id].col; if(pos[id].depth>maxDepth)maxDepth=pos[id].depth; });
    var W=PADX*2+(maxCol+1)*HGAP, H=PADY*2+(maxDepth+1)*VGAP;
    if(W<220) W=220; if(H<120) H=120;
    host.style.position="relative"; host.style.minWidth=W+"px"; host.style.height=H+"px";
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.style.width=W+"px"; svg.style.height=H+"px";
    function nx(id){ return PADX + pos[id].col*HGAP; }
    function ny(id){ return PADY + pos[id].depth*VGAP; }

    var seen={};
    Object.keys(frame.nodes).forEach(function(id){
      if(!pos[id]) return;
      seen[id]=true;
      var box=nodesEl[id];
      if(!box){ box=document.createElement("div"); box.className="tree-node"; host.appendChild(box); box._pop=true; nodesEl[id]=box; }
      box.style.left=nx(id)+"px"; box.style.top=ny(id)+"px";
      var v=String(frame.nodes[id].val);
      if(box.textContent!==v){ box.textContent=v; box.classList.remove("fill"); void box.offsetWidth; box.classList.add("fill"); }
      var cls="tree-node"+(frame.nodes[id].cls?(" "+frame.nodes[id].cls):"");
      if(box._pop){ cls+=" pop"; box._pop=false; }
      box.className=cls;
    });
    Object.keys(nodesEl).forEach(function(id){
      if(!seen[id]){ var b=nodesEl[id]; b.classList.add("gone");
        (function(bb){ setTimeout(function(){ if(bb.parentNode) bb.parentNode.removeChild(bb); },420); })(b);
        delete nodesEl[id]; }
    });

    var seenP={};
    if(frame.ptrs) Object.keys(frame.ptrs).forEach(function(id){
      if(!pos[id]) return;
      frame.ptrs[id].forEach(function(lbl,k){
        seenP[lbl]=true;
        var tag=ptrs[lbl];
        if(!tag){ tag=document.createElement("div"); tag.className="tree-ptr";
          tag.innerHTML='<span class="tree-ptr-lbl"></span>'; tag.firstChild.textContent=lbl;
          host.appendChild(tag); ptrs[lbl]=tag; }
        tag.style.setProperty("--pc", PTR_COLOR[lbl]||"var(--stamp)");
        tag.style.left=(nx(id)+NW-4)+"px"; tag.style.top=(ny(id)-6+k*20)+"px";
      });
    });
    Object.keys(ptrs).forEach(function(lbl){ if(!seenP[lbl]){ if(ptrs[lbl].parentNode) ptrs[lbl].parentNode.removeChild(ptrs[lbl]); delete ptrs[lbl]; } });

    // edges: redraw from MEASURED node centers, followed across the transition
    host._frame=frame;
    var token=(host._edgeToken=(host._edgeToken||0)+1);
    var start=(window.performance&&performance.now)?performance.now():Date.now();
    function drawEdges(){
      while(svg.firstChild) svg.removeChild(svg.firstChild);
      var hr=host.getBoundingClientRect();
      var f=host._frame;
      Object.keys(f.nodes).forEach(function(id){
        var pn=nodesEl[id]; if(!pn) return;
        ["left","right"].forEach(function(side){
          var c=f.nodes[id][side]; var cn=c&&nodesEl[c]; if(!cn) return;
          var pr=pn.getBoundingClientRect(), cr=cn.getBoundingClientRect();
          var x1=pr.left-hr.left+pr.width/2, y1=pr.top-hr.top+pr.height,
              x2=cr.left-hr.left+cr.width/2, y2=cr.top-hr.top;
          var ln=document.createElementNS(NS,"line");
          ln.setAttribute("x1",x1); ln.setAttribute("y1",y1); ln.setAttribute("x2",x2); ln.setAttribute("y2",y2);
          var ec=(f.edgeCls&&f.edgeCls[id+">"+c])||"";
          ln.setAttribute("class","tree-edge "+ec);
          svg.appendChild(ln);
        });
      });
    }
    function follow(){
      if(host._edgeToken!==token) return;
      drawEdges();
      var now=(window.performance&&performance.now)?performance.now():Date.now();
      if(now-start<560) requestAnimationFrame(follow);
    }
    drawEdges();
    if(window.requestAnimationFrame) requestAnimationFrame(follow);
  }

  function play(cfg){
    injectCSS();
    var host=cfg.host, svg=cfg.svg, frames=cfg.frames, i=0, timer=null, playing=false, bPlay, lbl;
    function draw(){
      var f=frames[i];
      render(host, svg, f);
      if(cfg.narrEl) cfg.narrEl.textContent=f.narr||"";
      if(cfg.codeHost) renderCode(cfg.codeHost, f.codeLines||cfg.code, f.code);
      if(lbl) lbl.textContent=(i+1)+" / "+frames.length;
    }
    function go(n){ i=((n%frames.length)+frames.length)%frames.length; draw(); }
    function start(){ playing=true; if(timer) clearInterval(timer); timer=setInterval(function(){ go(i+1); }, cfg.ms||1900); if(bPlay) bPlay.textContent="Pause"; }
    function stop(){ playing=false; if(timer){ clearInterval(timer); timer=null; } if(bPlay) bPlay.textContent="Play"; }
    var bar=document.createElement("div"); bar.className="tree-ctrls";
    var bPrev=cbtn("◀ Back","Previous step"); bPlay=cbtn("Pause","Play or pause"); var bNext=cbtn("Step ▶","Next step");
    lbl=document.createElement("span"); lbl.className="tree-step";
    bPrev.onclick=function(){ stop(); go(i-1); };
    bNext.onclick=function(){ stop(); go(i+1); };
    bPlay.onclick=function(){ if(playing) stop(); else start(); };
    bar.appendChild(bPrev); bar.appendChild(bPlay); bar.appendChild(bNext); bar.appendChild(lbl);
    var stage=host.parentNode; if(stage && stage.parentNode) stage.parentNode.insertBefore(bar, stage.nextSibling);
    draw(); start();
    return { stop:stop, start:start, go:go };
  }

  window.TreeAnim={ play:play, render:render, renderCode:renderCode, injectCSS:injectCSS };
})(window);
