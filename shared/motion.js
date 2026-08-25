/* ==========================================================================
   Motion — shared scroll/nav polish for the DSA visualizer site.

   Purely additive, progressive enhancement: every element this script
   touches is fully visible and usable if the script never runs (no
   IntersectionObserver support, JS disabled, etc). It does two things:

     1. Toggles a `.scrolled` class on `.masthead` so the sticky header can
        collapse into a compact, glassy toolbar once the page scrolls.
     2. Fades/slides `.panel` sections (and staggers `.algo-card` grids) in
        as they cross into view, via a `.js-reveal` class on <html> that
        theme.css only acts on when this script actually runs. Anything
        already on screen at load is marked visible immediately (no
        animation), so there is never a flash of hidden content.
   ========================================================================== */
(function(window, document){
  "use strict";

  function onReady(fn){
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function stickyMasthead(){
    var m=document.querySelector(".masthead");
    if(!m) return;
    var ticking=false;
    function update(){
      ticking=false;
      if(window.scrollY>8) m.classList.add("scrolled");
      else m.classList.remove("scrolled");
    }
    window.addEventListener("scroll", function(){
      if(!ticking){ window.requestAnimationFrame(update); ticking=true; }
    }, {passive:true});
    update();
  }

  function staggerCards(grid){
    var cards=Array.prototype.slice.call(grid.querySelectorAll(".algo-card"));
    cards.forEach(function(card, i){
      window.setTimeout(function(){ card.classList.add("in"); }, i*45);
    });
  }

  function revealOnScroll(){
    if(typeof window.IntersectionObserver!=="function") return;
    document.documentElement.classList.add("js-reveal");

    var vh=window.innerHeight;
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting) return;
        io.unobserve(entry.target);
        if(entry.target.classList.contains("algo-grid")) staggerCards(entry.target);
        else entry.target.classList.add("in");
      });
    }, {rootMargin:"0px 0px -8% 0px", threshold:0.12});

    function settle(el, isGrid){
      var r=el.getBoundingClientRect();
      if(r.top<vh*0.92){
        el.classList.add("no-anim");
        if(isGrid) staggerCards(el); else el.classList.add("in");
      } else {
        io.observe(el);
      }
    }

    Array.prototype.forEach.call(document.querySelectorAll(".panel"), function(p){ settle(p,false); });
    Array.prototype.forEach.call(document.querySelectorAll(".algo-grid"), function(g){ settle(g,true); });
  }

  onReady(function(){
    stickyMasthead();
    revealOnScroll();
  });

})(window, document);
