/* ==========================================================================
   ForestAnim — a step-at-a-time renderer for a forest of up-trees.

   Built for Union-Find (disjoint sets): every element is a node that points at
   a parent; a node that points at itself is a set's root/representative. Sets
   are the trees; union re-hangs one root under another; find walks a node up to
   its root (and path compression re-points nodes straight at it). Multi-way
   (a root can have many children), so this is a page-agnostic sibling of
   TreeAnim rather than a binary layout.

   A frame is a whole-forest snapshot:
     {
       nodes: { id: { val, parent, cls } , ... },  // parent = id, or self/null = root
       ptrs:  { id: [labels] },        // pointer tags on nodes (e.g. ["x","root"])
       edgeCls: { "child>parent": "active"|"formed" },
       code, codeLines, narr
     }
   node cls: "active" (red) | "target" (blue) | "found" (green) | "dim".
   Arrows point child -> parent (toward the representative); roots get a ring.

   API mirrors the other renderers:
     ForestAnim.play({ host, svg, narrEl, codeHost, code, frames, ms }) -> {stop,start,go}
     ForestAnim.render(host, svg, frame)
     ForestAnim.renderCode(host, lines, codeLine)
     ForestAnim.injectCSS()
   ========================================================================== */
(function(window){
  "use strict";
  var NS="http://www.w3.org/2000/svg";
  var NR=21, HGAP=58, VGAP=74, PADX=30, PADY=30, TREEGAP=34;
  var PTR_COLOR={ x:"var(--stamp)", y:"var(--plot)", root:"var(--seal)", rx:"var(--stamp)", ry:"var(--plot)" };

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
      ".forest-stage{position:relative;overflow:auto}",
      ".forest-stage .forest-svg{position:absolute;left:0;top:0;pointer-events:none;z-index:1}",
      ".fnode{position:absolute;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:2;font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:16px;color:var(--ink,#1C2B24);background:#fff;border:2px solid var(--ink,#1C2B24);transform:translate(-50%,-50%);transition:left .45s var(--ease,ease),top .45s var(--ease,ease),border-color .3s var(--ease,ease),background .3s var(--ease,ease),color .3s var(--ease,ease),box-shadow .3s var(--ease,ease),opacity .35s var(--ease,ease)}",
      ".fnode.root{box-shadow:0 0 0 3px rgba(46,107,79,.25)}",
      ".fnode.active{border-color:var(--stamp,#BE3A1D);color:var(--stamp,#BE3A1D)}",
      ".fnode.target{border-color:var(--plot,#1F4E79);color:var(--plot,#1F4E79)}",
      ".fnode.found{border-color:var(--seal,#2E6B4F);color:var(--seal,#2E6B4F);background:rgba(46,107,79,.10)}",
      ".fnode.dim{opacity:.4}",
      ".fnode.pop{animation:fpop .42s var(--ease,ease)}",
      ".fedge{stroke:var(--ink-soft,#5D6E61);stroke-width:2;fill:none}",
      ".fedge.active{stroke:var(--stamp,#BE3A1D);stroke-width:3}",
      ".fedge.formed{stroke:var(--seal,#2E6B4F);stroke-width:3}",
      ".fehead{fill:var(--ink-soft,#5D6E61)}",
      ".fehead.active{fill:var(--stamp,#BE3A1D)}",
      ".fehead.formed{fill:var(--seal,#2E6B4F)}",
      ".fptr{position:absolute;z-index:3;transform:translate(-50%,0);transition:left .45s var(--ease,ease),top .45s var(--ease,ease)}",
      ".fptr .fptr-lbl{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;color:#fff;background:var(--pc,#1F4E79);padding:2px 6px;border-radius:4px;white-space:nowrap}",
      ".forest-ctrls{display:flex;align-items:center;gap:7px;margin:10px 0 2px;flex-wrap:wrap}",
      ".forest-cbtn{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:14px;line-height:1;padding:7px 13px;border:1px solid var(--ink,#1C2B24);background:#F4F7EE;color:var(--ink,#1C2B24);border-radius:5px;cursor:pointer}",
      ".forest-cbtn:hover{background:var(--ink,#1C2B24);color:var(--paper,#EAEFE2)}",
      ".forest-step{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ink-soft,#5D6E61);margin-left:6px}",
      "@keyframes fpop{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}"
    ].join("\n");
    var s=document.createElement("style"); s.setAttribute("data-forest-anim","1");
    s.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(s);
  }
  function cbtn(txt,label){ var b=document.createElement("button"); b.type="button"; b.className="forest-cbtn"; b.textContent=txt; b.setAttribute("aria-label",label); return b; }

  function isRoot(nodes,id){ var p=nodes[id].parent; return p==null || String(p)===String(id); }
  function layout(nodes){
    // children map
    var kids={}, roots=[];
    Object.keys(nodes).forEach(function(id){ kids[id]=[]; });
    Object.keys(nodes).forEach(function(id){ if(isRoot(nodes,id)) roots.push(id); else kids[String(nodes[id].parent)].push(id); });
    Object.keys(kids).forEach(function(id){ kids[id].sort(function(a,b){ return (+a)-(+b) || (a<b?-1:1); }); });
    roots.sort(function(a,b){ return (+a)-(+b) || (a<b?-1:1); });
    var pos={}, col={v:0};
    function rec(id, depth){
      var ks=kids[id];
      if(!ks.length){ pos[id]={col:col.v++, depth:depth}; return; }
      ks.forEach(function(k){ rec(k, depth+1); });
      var s=0; ks.forEach(function(k){ s+=pos[k].col; }); pos[id]={col:s/ks.length, depth:depth};
    }
    roots.forEach(function(r){ rec(r,0); col.v += 0.6; }); // small gap between trees
    return pos;
  }

  function render(host, svg, frame){
    injectCSS();
    if(!host._nodes) host._nodes={};
    if(!host._ptrs) host._ptrs={};
    var nodesEl=host._nodes, ptrs=host._ptrs, nodes=frame.nodes;
    var pos=layout(nodes);
    var maxCol=0, maxD=0; Object.keys(pos).forEach(function(id){ if(pos[id].col>maxCol)maxCol=pos[id].col; if(pos[id].depth>maxD)maxD=pos[id].depth; });
    var W=PADX*2+maxCol*HGAP+NR*2, H=PADY*2+maxD*VGAP+NR*2; if(W<240)W=240; if(H<120)H=120;
    host.style.position="relative"; host.style.minWidth=W+"px"; host.style.height=H+"px";
    svg.setAttribute("viewBox","0 0 "+W+" "+H); svg.style.width=W+"px"; svg.style.height=H+"px";
    function nx(id){ return PADX+NR+pos[id].col*HGAP; }
    function ny(id){ return PADY+NR+pos[id].depth*VGAP; }

    var seen={};
    Object.keys(nodes).forEach(function(id){
      seen[id]=true;
      var box=nodesEl[id];
      if(!box){ box=document.createElement("div"); box.className="fnode"; box.textContent=(nodes[id].val!==undefined?nodes[id].val:id); host.appendChild(box); box._pop=true; nodesEl[id]=box; }
      box.style.left=nx(id)+"px"; box.style.top=ny(id)+"px";
      var cls="fnode"+(isRoot(nodes,id)?" root":"")+(nodes[id].cls?(" "+nodes[id].cls):"");
      if(box._pop){ cls+=" pop"; box._pop=false; } box.className=cls;
    });
    Object.keys(nodesEl).forEach(function(id){ if(!seen[id]){ if(nodesEl[id].parentNode)nodesEl[id].parentNode.removeChild(nodesEl[id]); delete nodesEl[id]; }});

    // pointer tags
    var seenP={};
    if(frame.ptrs) Object.keys(frame.ptrs).forEach(function(id){ if(!pos[id])return;
      frame.ptrs[id].forEach(function(lbl,k){ seenP[lbl]=true;
        var tag=ptrs[lbl];
        if(!tag){ tag=document.createElement("div"); tag.className="fptr"; tag.innerHTML='<span class="fptr-lbl"></span>'; tag.firstChild.textContent=lbl; host.appendChild(tag); ptrs[lbl]=tag; }
        tag.style.setProperty("--pc", PTR_COLOR[lbl]||"var(--stamp)");
        tag.style.left=nx(id)+"px"; tag.style.top=(ny(id)-NR-16-k*20)+"px";
      });
    });
    Object.keys(ptrs).forEach(function(lbl){ if(!seenP[lbl]){ if(ptrs[lbl].parentNode)ptrs[lbl].parentNode.removeChild(ptrs[lbl]); delete ptrs[lbl]; }});

    // arrows child -> parent, measured & followed across the glide
    host._frame=frame;
    var token=(host._tok=(host._tok||0)+1), start=(window.performance&&performance.now)?performance.now():Date.now();
    function draw(){
      while(svg.firstChild) svg.removeChild(svg.firstChild);
      var hr=host.getBoundingClientRect(), f=host._frame;
      Object.keys(f.nodes).forEach(function(id){
        if(isRoot(f.nodes,id)) return;
        var pid=f.nodes[id].parent, cn=nodesEl[id], pn=nodesEl[pid]; if(!cn||!pn) return;
        var cr=cn.getBoundingClientRect(), pr=pn.getBoundingClientRect();
        var cx=cr.left-hr.left+cr.width/2, cy=cr.top-hr.top+cr.height/2,
            px=pr.left-hr.left+pr.width/2, py=pr.top-hr.top+pr.height/2;
        var dx=px-cx, dy=py-cy, d=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/d, uy=dy/d;
        var x1=cx+ux*NR, y1=cy+uy*NR, x2=px-ux*(NR+8), y2=py-uy*(NR+8);
        var ec=(f.edgeCls&&f.edgeCls[id+">"+pid])||"";
        var ln=document.createElementNS(NS,"line"); ln.setAttribute("x1",x1);ln.setAttribute("y1",y1);ln.setAttribute("x2",x2);ln.setAttribute("y2",y2);
        ln.setAttribute("class","fedge "+ec); svg.appendChild(ln);
        var ax=px-ux*NR, ay=py-uy*NR, nx2=-uy, ny2=ux, s=5;
        var tri=document.createElementNS(NS,"polygon");
        tri.setAttribute("points",ax+","+ay+" "+(ax-ux*10+nx2*s)+","+(ay-uy*10+ny2*s)+" "+(ax-ux*10-nx2*s)+","+(ay-uy*10-ny2*s));
        tri.setAttribute("class","fehead "+ec); svg.appendChild(tri);
      });
    }
    function follow(){ if(host._tok!==token)return; draw(); var now=(window.performance&&performance.now)?performance.now():Date.now(); if(now-start<560) requestAnimationFrame(follow); }
    draw(); if(window.requestAnimationFrame) requestAnimationFrame(follow);
  }

  function play(cfg){
    injectCSS();
    var host=cfg.host, svg=cfg.svg, frames=cfg.frames, i=0, timer=null, playing=false, bPlay, lbl;
    function draw(){ var f=frames[i]; render(host, svg, f);
      if(cfg.narrEl) cfg.narrEl.textContent=f.narr||"";
      if(cfg.codeHost) renderCode(cfg.codeHost, f.codeLines||cfg.code, f.code);
      if(lbl) lbl.textContent=(i+1)+" / "+frames.length; }
    function go(n){ i=((n%frames.length)+frames.length)%frames.length; draw(); }
    function start(){ playing=true; if(timer) clearInterval(timer); timer=setInterval(function(){ go(i+1); }, cfg.ms||1900); if(bPlay) bPlay.textContent="Pause"; }
    function stop(){ playing=false; if(timer){ clearInterval(timer); timer=null; } if(bPlay) bPlay.textContent="Play"; }
    var bar=document.createElement("div"); bar.className="forest-ctrls";
    var bPrev=cbtn("◀ Back","Previous step"); bPlay=cbtn("Pause","Play or pause"); var bNext=cbtn("Step ▶","Next step");
    lbl=document.createElement("span"); lbl.className="forest-step";
    bPrev.onclick=function(){ stop(); go(i-1); };
    bNext.onclick=function(){ stop(); go(i+1); };
    bPlay.onclick=function(){ if(playing) stop(); else start(); };
    bar.appendChild(bPrev); bar.appendChild(bPlay); bar.appendChild(bNext); bar.appendChild(lbl);
    var stage=host.parentNode; if(stage && stage.parentNode) stage.parentNode.insertBefore(bar, stage.nextSibling);
    draw(); start();
    return { stop:stop, start:start, go:go };
  }

  window.ForestAnim={ play:play, render:render, renderCode:renderCode, injectCSS:injectCSS };
})(window);
