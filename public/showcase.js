/*!
 * DropStack Review Engine — showcase strip embed
 *
 * Drop this on the client's site (the DropStack Mini-site, Wix, WordPress,
 * plain HTML):
 *
 *   <script src="https://YOUR-REVIEWS-SITE/showcase.js" async></script>
 *
 * Options, as data- attributes on that same tag:
 *   data-target    "#reviews"  CSS selector to render into. Default: inline,
 *                              right where the script tag sits
 *   data-max-width "1080"      max width in px. Default 1080. "none" to fill
 *   data-title     "..."       iframe title for screen readers
 *
 * Shows the business's hand-entered featured reviews (never demo rows). With
 * none entered it takes up no space at all.
 * Conservative ES5, no dependencies: it runs inside whatever page builder the
 * client uses. Same pattern as Lead Capture's embed.js.
 */
(function () {
  "use strict";

  var MESSAGE_TYPE = "dropstack:reviews:height";

  function findSelf() {
    if (document.currentScript) return document.currentScript;
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("showcase.js") !== -1) return all[i];
    }
    return null;
  }

  var self = findSelf();
  if (!self || !self.src) return;

  var origin;
  try {
    origin = new URL(self.src, window.location.href).origin;
  } catch (e) {
    var a = document.createElement("a");
    a.href = self.src;
    origin = a.protocol + "//" + a.host;
  }

  function attr(name, fallback) {
    var v = self.getAttribute("data-" + name);
    return v === null || v === "" ? fallback : v;
  }

  var iframe = document.createElement("iframe");
  iframe.src = origin + "/showcase";
  iframe.title = attr("title", "Customer reviews");
  iframe.loading = "lazy";
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("scrolling", "no");
  iframe.allowTransparency = "true";

  var maxWidth = attr("max-width", "1080");
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.maxWidth = maxWidth === "none" ? "none" : maxWidth + "px";
  iframe.style.margin = "0 auto";
  iframe.style.border = "0";
  iframe.style.overflow = "hidden";
  iframe.style.height = "0px"; // nothing shown until there is something to show
  iframe.style.colorScheme = "light";
  iframe.style.transition = "height 120ms ease-out";

  var target = attr("target", "");
  var mounted = false;
  if (target) {
    var el = document.querySelector(target);
    if (el) { el.appendChild(iframe); mounted = true; }
  }
  if (!mounted && self.parentNode) { self.parentNode.insertBefore(iframe, self); mounted = true; }
  if (!mounted) document.body.appendChild(iframe);

  // Trust a height only when BOTH the origin and the sending window match.
  function onMessage(event) {
    if (event.origin !== origin) return;
    if (event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== MESSAGE_TYPE) return;
    var height = parseInt(data.height, 10);
    if (!isFinite(height) || height < 0 || height > 20000) return;
    iframe.style.height = height + "px";
  }
  if (window.addEventListener) window.addEventListener("message", onMessage, false);
  else if (window.attachEvent) window.attachEvent("onmessage", onMessage);
})();
