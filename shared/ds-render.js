/* ==========================================================================
   DSRender — shared declarative renderers for the data-structure pages.

   Every renderer takes a plain-object "struct" snapshot and redraws its
   container from scratch. Structures here are small (a teaching tool, not
   a perf-critical app), so a full redraw per frame keeps every page's logic
   simple instead of hand-rolling DOM diffing per shape.

     DSRender.slots(host, cells)
       cells: [{val, role, ptr, label}]  — a fixed-slot row with an optional
       pointer badge above each cell (HEAD/TAIL/TOP/FRONT/REAR/...). Used by
       array-backed structures: stack, queue, circular queue, deque, and the
       bucket row of a hash table.

     DSRender.sequence(host, struct)
       struct: {dir:'h'|'v', double, nullEnd, emptyText,
                nodes:[{val, role, ptr, label}], linkActive:[bool,...], linkLanded:[bool,...]}
       Linked boxes with directional arrows. Used by linked lists and, in
       vertical mode, a single hash-table bucket's collision chain. A node's
       own "just created" pop-in is just `role:"...landed"` (same convention
       as array cells — `.cell.landed` isn't scoped to arrays). `linkLanded[i]`
       is the arrow equivalent: the arrow *before* nodes[i] plays a one-shot
       "just formed" animation, for the moment a pointer gets wired up right
       after the node it belongs to appears.

     DSRender.tree(nodesHost, svgEl, root, opts)
       root: {id, val, role, label, left, right} | null
       Recursive parent/child boxes with SVG connector lines, sized against
       svgEl's parent element. Used by BST, AVL tree, and the binary heap
       (priority queue).

     DSRender.graph(nodesHost, svgEl, struct, opts)
       struct: {nodes:[{id, val, role, label}], edges:[{from, to, active, settled, weight}]}
       opts: {emptyText, directed}
       Nodes placed evenly around a circle inside svgEl's parent element,
       edges drawn as SVG lines shortened to stop at each node's rendered
       radius (measured via getBoundingClientRect, not assumed). `weight`
       (optional, any node on any edge) draws a small labeled tag at the
       edge's midpoint — used by Dijkstra and Kruskal's MST. `opts.directed`
       (optional, page-level — every edge on a directed page renders with
       one) draws an arrowhead at the `to` end — used by Dijkstra and
       Topological Sort; the plain BFS/DFS graph page leaves both unset and
       renders exactly as before.

     DSRender.callstack(host, frames)
       frames: [{fn, args, ret, role}, ...] — oldest (outermost) call first,
       newest (innermost, currently executing) call last, exactly like a
       real call stack's contents. Renders as vertical boxes, newest on top,
       each indented one step further than the last so the recursion depth
       reads as a staircase. `ret` (optional) shows a return value on a
       frame that's already produced one, for the unwind-back-down half of
       a call. `role` (optional, e.g. "active") highlights the frame the
       current step is actually working on. Used by the Recursion
       foundation page; designed for reuse by any future page whose
       operation is genuinely recursive rather than a retrofit of one.
   ========================================================================== */
(function(window){
  "use strict";

  function el(tag, cls, text){
    var e=document.createElement(tag);
    if(cls) e.className=cls;
    if(text!==undefined) e.textContent=text;
    return e;
  }

  function slots(host, cells){
    if(!host) return;
    host.innerHTML="";
    if(!cells || !cells.length){
      host.appendChild(el("div","seq-empty","Empty"));
      return;
    }
    cells.forEach(function(c,i){
      var item=el("div","array-item");
      var ptrCls="ptr-slot"+(c.ptrClass?" "+c.ptrClass:" a");
      item.appendChild(el("div",ptrCls,c.ptr||""));
      var cell=el("div","cell"+(c.role?" "+c.role:""));
      cell.textContent=(c.val===null||c.val===undefined)?"·":c.val;
      item.appendChild(cell);
      item.appendChild(el("div","array-idx",c.label!==undefined?c.label:i));
      host.appendChild(item);
    });
  }

  function sequence(host, struct){
    if(!host) return;
    host.innerHTML="";
    struct=struct||{};
    var dir=struct.dir||"h";
    var row=el("div","seq-row"+(dir==="v"?" seq-v":""));
    var nodes=struct.nodes||[];
    if(!nodes.length && !struct.nullEnd){
      row.appendChild(el("div","seq-empty",struct.emptyText||"Empty"));
      host.appendChild(row);
      return;
    }
    nodes.forEach(function(node,i){
      if(i>0){
        var arrowCls="seq-arrow "+(dir==="v"?"vert":"horiz")+(struct.double?" back":"")+
          ((struct.linkActive&&struct.linkActive[i-1])?" active":"")+
          ((struct.linkLanded&&struct.linkLanded[i-1])?" landed":"");
        row.appendChild(el("div",arrowCls));
      }
      var n=el("div","seq-node");
      var ptrCls="ptr-slot"+(node.ptrClass?" "+node.ptrClass:" a");
      n.appendChild(el("div",ptrCls,node.ptr||""));
      var cell=el("div","cell"+(node.role?" "+node.role:""));
      cell.textContent=node.val;
      n.appendChild(cell);
      n.appendChild(el("div","array-idx",node.label!==undefined?node.label:i));
      row.appendChild(n);
    });
    if(struct.nullEnd){
      if(nodes.length){
        row.appendChild(el("div","seq-arrow "+(dir==="v"?"vert":"horiz")+
          ((struct.linkActive&&struct.linkActive[nodes.length-1])?" active":"")+
          ((struct.linkLanded&&struct.linkLanded[nodes.length-1])?" landed":"")));
      }
      row.appendChild(el("div","seq-null","NULL"));
    }
    host.appendChild(row);
  }

  function drawTreeLinks(svg, wrapEl, boxEls, links){
    if(!links.length){ svg.innerHTML=""; return; }
    var base=wrapEl.getBoundingClientRect();
    svg.setAttribute("viewBox","0 0 "+wrapEl.offsetWidth+" "+wrapEl.offsetHeight);
    svg.setAttribute("width",wrapEl.offsetWidth);
    svg.setAttribute("height",wrapEl.offsetHeight);
    var out="";
    links.forEach(function(L){
      var pb=boxEls[L.p], cb=boxEls[L.c];
      if(!pb||!cb) return;
      var pr=pb.getBoundingClientRect(), cr=cb.getBoundingClientRect();
      var x1=pr.left+pr.width/2-base.left, y1=pr.bottom-base.top;
      var x2=cr.left+cr.width/2-base.left, y2=cr.top-base.top;
      var my=y1+(y2-y1)/2;
      var cls=L.active?"active":(L.settled?"settled":"");
      out+='<path class="'+cls+'" d="M'+x1+' '+y1+' V'+my+' H'+x2+' V'+y2+'"></path>';
    });
    svg.innerHTML=out;
  }

  function tree(nodesHost, svgEl, root, opts){
    if(!nodesHost || !svgEl) return;
    opts=opts||{};
    nodesHost.innerHTML="";
    var wrapEl=svgEl.parentElement;
    var boxEls={}, links=[];

    function place(node, parent){
      var wrap=el("div","tnode");
      var box=el("div","tbox");
      var cell=el("div","cell"+(node.role?" "+node.role:""));
      cell.textContent=node.val;
      box.appendChild(cell);
      wrap.appendChild(box);
      if(node.label!==undefined) wrap.appendChild(el("div","tlabel",node.label));
      boxEls[node.id]=box;
      var kids=[node.left,node.right].filter(Boolean);
      if(kids.length){
        var kidsWrap=el("div","tkids");
        kids.forEach(function(k){
          place(k,kidsWrap);
          links.push({
            p:node.id, c:k.id,
            active: (k.role&&k.role.indexOf("head")>=0) || (node.role&&node.role.indexOf("head")>=0),
            settled: (k.role&&k.role.indexOf("sorted")>=0) || (k.role&&k.role.indexOf("settled")>=0)
          });
        });
        wrap.appendChild(kidsWrap);
      }
      parent.appendChild(wrap);
    }

    if(root){
      place(root, nodesHost);
    } else {
      nodesHost.appendChild(el("div","seq-empty",opts.emptyText||"Empty tree"));
    }
    drawTreeLinks(svgEl, wrapEl, boxEls, links);
    return {boxEls:boxEls};
  }

  function graph(nodesHost, svgEl, struct, opts){
    if(!nodesHost || !svgEl) return;
    opts=opts||{};
    struct=struct||{nodes:[],edges:[]};
    nodesHost.innerHTML="";
    var wrapEl=svgEl.parentElement;
    var w=wrapEl.clientWidth||600, h=wrapEl.clientHeight||280;
    var cx=w/2, cy=h/2, r=Math.max(40,Math.min(w,h)/2-34);
    var nodes=struct.nodes||[];
    var n=nodes.length;
    var pos={};

    if(!n){
      nodesHost.appendChild(el("div","seq-empty",opts.emptyText||"No vertices yet"));
    }
    var nodeR=18;
    nodes.forEach(function(node,i){
      var angle=-Math.PI/2 + (i*2*Math.PI/Math.max(n,1));
      var x=cx+r*Math.cos(angle), y=cy+r*Math.sin(angle);
      pos[node.id]={x:x,y:y};
      var gn=el("div","gnode");
      gn.style.left=x+"px"; gn.style.top=y+"px";
      var cell=el("div","cell"+(node.role?" "+node.role:""));
      cell.textContent=(node.val!==undefined?node.val:node.id);
      gn.appendChild(cell);
      if(node.label!==undefined) gn.appendChild(el("div","tlabel",node.label));
      nodesHost.appendChild(gn);
      if(i===0 && cell.offsetWidth) nodeR=cell.offsetWidth/2;
    });

    svgEl.setAttribute("viewBox","0 0 "+w+" "+h);
    svgEl.setAttribute("width",w);
    svgEl.setAttribute("height",h);
    var out=opts.directed ?
      '<defs><marker id="graph-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"></path></marker></defs>' : "";
    (struct.edges||[]).forEach(function(e){
      var a=pos[e.from], b=pos[e.to];
      if(!a||!b) return;
      var cls=e.active?"active":(e.settled?"settled":"");
      var dx=b.x-a.x, dy=b.y-a.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
      var ux=dx/dist, uy=dy/dist;
      var x1=a.x+ux*nodeR, y1=a.y+uy*nodeR;
      var endInset=opts.directed ? nodeR+7 : nodeR;
      var x2=b.x-ux*endInset, y2=b.y-uy*endInset;
      out+='<line class="'+cls+'" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'"'+
        (opts.directed?' marker-end="url(#graph-arrowhead)"':'')+'></line>';
      if(e.weight!==undefined){
        var mx=(x1+x2)/2, my=(y1+y2)/2;
        out+='<rect class="edge-weight-bg" x="'+(mx-10)+'" y="'+(my-8)+'" width="20" height="16" rx="2"></rect>'+
          '<text class="edge-weight" x="'+mx+'" y="'+(my+4)+'" text-anchor="middle">'+e.weight+'</text>';
      }
    });
    svgEl.innerHTML=out;
    return {pos:pos};
  }

  function callstack(host, frames){
    if(!host) return;
    host.innerHTML="";
    frames=frames||[];
    if(!frames.length){
      host.appendChild(el("div","seq-empty","Call stack empty"));
      return;
    }
    for(var i=frames.length-1;i>=0;i--){
      var f=frames[i];
      var box=el("div","stackframe"+(f.role?" "+f.role:""));
      box.style.marginLeft=(i*14)+"px";
      box.appendChild(el("div","stackframe-head",f.fn+"("+(f.args||"")+")"));
      if(f.ret!==undefined) box.appendChild(el("div","stackframe-ret","returns "+f.ret));
      host.appendChild(box);
    }
  }

  window.DSRender = { slots:slots, sequence:sequence, tree:tree, graph:graph, callstack:callstack };

})(window);
