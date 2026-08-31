/* ==========================================================================
   GraphAnim — a step-at-a-time renderer for graphs.

   Graph-world sibling of TreeAnim / LLAnim / ArrAnim. Draws a graph one C step
   at a time. Unlike a tree, a graph's SHAPE doesn't change during an
   algorithm — only which node is current, which are queued, which are done,
   and which edge is being examined. So node positions are FIXED (given per
   node in pixel coords), edges are drawn straight from measured node centers
   (shortened to the node radius), and only classes transition. That keeps BFS
   frontiers, DFS backtracking, Dijkstra relaxations and MST edge picks all
   legible with the same renderer.

   A frame is a whole-graph snapshot:
     {
       nodes: { id: { x, y, val, cls, label } , ... },  // x,y in the viewBox
       edges: [ { from, to, weight, cls } , ... ],
       directed: bool,            // draw arrowheads at each edge's `to` end
       code, codeLines, narr
     }
   node cls: "active" (red, current) | "frontier" (blue, queued/on the stack)
             | "done" (green, visited/settled) | "target" | "dim".
   edge cls: "active" (red, being examined) | "tree" (green, chosen/settled)
             | "dim" (faded).

   API mirrors the others:
     GraphAnim.play({ host, svg, narrEl, codeHost, code, frames, ms }) -> {stop,start,go}
     GraphAnim.render(host, svg, frame)
     GraphAnim.renderCode(host, lines, codeLine)
     GraphAnim.injectCSS()
   ========================================================================== */
(function(window){
  "use strict";
  var NS="http://www.w3.org/2000/svg";
  var NR=21; // node radius (42px circle)

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
      ".graph-stage{position:relative;overflow:auto}",
      ".graph-stage .graph-svg{position:absolute;left:0;top:0;pointer-events:none;z-index:1}",
      ".ganim-node{position:absolute;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:2;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:16px;color:var(--ink,#1C2B24);background:#fff;border:2px solid var(--ink,#1C2B24);transform:translate(-50%,-50%);transition:border-color .3s var(--ease,ease),background .3s var(--ease,ease),color .3s var(--ease,ease),box-shadow .3s var(--ease,ease)}",
      ".ganim-node.active{border-color:var(--stamp,#BE3A1D);color:var(--stamp,#BE3A1D);box-shadow:0 0 0 3px rgba(190,58,29,.18)}",
      ".ganim-node.frontier{border-color:var(--plot,#1F4E79);color:var(--plot,#1F4E79);background:rgba(31,78,121,.07)}",
      ".ganim-node.done{border-color:var(--seal,#2E6B4F);color:var(--seal,#2E6B4F);background:rgba(46,107,79,.12)}",
      ".ganim-node.target{border-color:var(--plot,#1F4E79);color:var(--plot,#1F4E79);border-style:dashed}",
      ".ganim-node.dim{opacity:.4}",
      ".ganim-node.pop{animation:gapop .42s var(--ease,ease)}",
      ".ganim-nlabel{position:absolute;z-index:3;transform:translate(-50%,0);font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;color:#fff;background:var(--plot,#1F4E79);padding:1px 6px;border-radius:4px;white-space:nowrap;pointer-events:none}",
      ".ganim-edge{stroke:var(--ink-soft,#5D6E61);stroke-width:2;fill:none}",
      ".ganim-edge.active{stroke:var(--stamp,#BE3A1D);stroke-width:3}",
      ".ganim-edge.tree{stroke:var(--seal,#2E6B4F);stroke-width:3}",
      ".ganim-edge.dim{stroke:var(--rule,#C9D2BE);opacity:.55}",
      ".ganim-ehead{fill:var(--ink-soft,#5D6E61)}",
      ".ganim-ehead.active{fill:var(--stamp,#BE3A1D)}",
      ".ganim-ehead.tree{fill:var(--seal,#2E6B4F)}",
      ".ganim-wt{fill:#fff;stroke:var(--rule,#C9D2BE);stroke-width:1}",
      ".ganim-wlabel{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;fill:var(--ink,#1C2B24)}",
      ".graph-ctrls{display:flex;align-items:center;gap:7px;margin:10px 0 2px;flex-wrap:wrap}",
      ".graph-cbtn{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:14px;line-height:1;padding:7px 13px;border:1px solid var(--ink,#1C2B24);background:#F4F7EE;color:var(--ink,#1C2B24);border-radius:5px;cursor:pointer}",
      ".graph-cbtn:hover{background:var(--ink,#1C2B24);color:var(--paper,#EAEFE2)}",
      ".graph-step{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-soft,#5D6E61);margin-left:6px}",
      "@keyframes gapop{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}"
    ].join("\n");
    var s=document.createElement("style"); s.setAttribute("data-graph-anim","1");
    s.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(s);
  }
  function cbtn(txt,label){ var b=document.createElement("button"); b.type="button"; b.className="graph-cbtn"; b.textContent=txt; b.setAttribute("aria-label",label); return b; }

  function render(host, svg, frame){
    injectCSS();
    if(!host._nodes) host._nodes={};
    var nodesEl=host._nodes, labelsEl=host._labels||(host._labels={});
    var ns=frame.nodes||{};
    // size the stage from node coords
    var maxX=0, maxY=0;
    Object.keys(ns).forEach(function(id){ if(ns[id].x>maxX)maxX=ns[id].x; if(ns[id].y>maxY)maxY=ns[id].y; });
    var W=maxX+NR+24, H=maxY+NR+34; if(W<240)W=240; if(H<160)H=160;
    host.style.position="relative"; host.style.minWidth=W+"px"; host.style.height=H+"px";
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.style.width=W+"px"; svg.style.height=H+"px";

    // ---- edges (drawn first, behind nodes) ----
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    (frame.edges||[]).forEach(function(e){
      var a=ns[e.from], b=ns[e.to]; if(!a||!b) return;
      var dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/d, uy=dy/d;
      var x1=a.x+ux*NR, y1=a.y+uy*NR;
      var endInset=frame.directed?NR+8:NR;
      var x2=b.x-ux*endInset, y2=b.y-uy*endInset;
      var cls=e.cls||"";
      var ln=document.createElementNS(NS,"line");
      ln.setAttribute("x1",x1); ln.setAttribute("y1",y1); ln.setAttribute("x2",x2); ln.setAttribute("y2",y2);
      ln.setAttribute("class","ganim-edge "+cls); svg.appendChild(ln);
      if(frame.directed){
        var ax=b.x-ux*NR, ay=b.y-uy*NR; // tip at node edge
        var px=-uy, py=ux, s=5;
        var p1x=ax-ux*10+px*s, p1y=ay-uy*10+py*s, p2x=ax-ux*10-px*s, p2y=ay-uy*10-py*s;
        var tri=document.createElementNS(NS,"polygon");
        tri.setAttribute("points",ax+","+ay+" "+p1x+","+p1y+" "+p2x+","+p2y);
        tri.setAttribute("class","ganim-ehead "+cls); svg.appendChild(tri);
      }
      if(e.weight!==undefined && e.weight!==null){
        var mx=(x1+x2)/2, my=(y1+y2)/2;
        var rc=document.createElementNS(NS,"rect");
        rc.setAttribute("x",mx-11); rc.setAttribute("y",my-9); rc.setAttribute("width",22); rc.setAttribute("height",18); rc.setAttribute("rx",3);
        rc.setAttribute("class","ganim-wt"); svg.appendChild(rc);
        var tx=document.createElementNS(NS,"text");
        tx.setAttribute("x",mx); tx.setAttribute("y",my+4); tx.setAttribute("text-anchor","middle");
        tx.setAttribute("class","ganim-wlabel"); tx.textContent=e.weight; svg.appendChild(tx);
      }
    });

    // ---- nodes ----
    var seen={};
    Object.keys(ns).forEach(function(id){
      seen[id]=true; var n=ns[id];
      var box=nodesEl[id];
      if(!box){ box=document.createElement("div"); box.className="ganim-node"; host.appendChild(box); box._pop=true; nodesEl[id]=box; }
      box.style.left=n.x+"px"; box.style.top=n.y+"px";
      box.textContent=(n.val!==undefined?n.val:id);
      var cls="ganim-node"+(n.cls?(" "+n.cls):"");
      if(box._pop){ cls+=" pop"; box._pop=false; }
      box.className=cls;
      // optional label badge (e.g. distance) below the node
      var lb=labelsEl[id];
      if(n.label!==undefined && n.label!==null && n.label!==""){
        if(!lb){ lb=document.createElement("div"); lb.className="ganim-nlabel"; host.appendChild(lb); labelsEl[id]=lb; }
        lb.textContent=n.label; lb.style.left=n.x+"px"; lb.style.top=(n.y+NR+3)+"px";
      } else if(lb){ if(lb.parentNode)lb.parentNode.removeChild(lb); delete labelsEl[id]; }
    });
    Object.keys(nodesEl).forEach(function(id){ if(!seen[id]){ if(nodesEl[id].parentNode)nodesEl[id].parentNode.removeChild(nodesEl[id]); delete nodesEl[id]; if(labelsEl[id]){ if(labelsEl[id].parentNode)labelsEl[id].parentNode.removeChild(labelsEl[id]); delete labelsEl[id]; } }});
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
    var bar=document.createElement("div"); bar.className="graph-ctrls";
    var bPrev=cbtn("◀ Back","Previous step"); bPlay=cbtn("Pause","Play or pause"); var bNext=cbtn("Step ▶","Next step");
    lbl=document.createElement("span"); lbl.className="graph-step";
    bPrev.onclick=function(){ stop(); go(i-1); };
    bNext.onclick=function(){ stop(); go(i+1); };
    bPlay.onclick=function(){ if(playing) stop(); else start(); };
    bar.appendChild(bPrev); bar.appendChild(bPlay); bar.appendChild(bNext); bar.appendChild(lbl);
    var stage=host.parentNode; if(stage && stage.parentNode) stage.parentNode.insertBefore(bar, stage.nextSibling);
    draw(); start();
    return { stop:stop, start:start, go:go };
  }

  window.GraphAnim={ play:play, render:render, renderCode:renderCode, injectCSS:injectCSS };
})(window);
