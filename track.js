// track.js — FTR Kitchens public-site visitor tracking
// Hosted at https://ftrkitchens.com/track.js and loaded with:
//   <script src="/track.js" defer></script>
// Sends to the Supabase Edge Function site-collect (no API key needed; the function
// only accepts https://ftrkitchens.com and https://www.ftrkitchens.com).
// Pattern: Damstrong ds-tracker.js. Does NOT capture form field contents.

(function () {
  var COLLECT = "https://stckfiujhrdwqmuvwzlt.supabase.co/functions/v1/site-collect";
  var COOKIE_VID = "_ds_vid";
  var COOKIE_DAYS = 730;
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

  function setCookie(name, val, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie =
      name + "=" + encodeURIComponent(val) + ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }
  function getCookie(name) {
    var m = document.cookie.match("(^|;)\\s*" + name + "=([^;]*)");
    return m ? decodeURIComponent(m[2]) : "";
  }
  function genId() {
    return "ftr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  var vid = getCookie(COOKIE_VID);
  if (!vid) {
    vid = genId();
    setCookie(COOKIE_VID, vid, COOKIE_DAYS);
  }

  var sessionId = "";
  try {
    sessionId = sessionStorage.getItem("_ftr_sid") || "";
    if (!sessionId) {
      sessionId = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem("_ftr_sid", sessionId);
    }
  } catch (e) {
    sessionId = "s_" + Date.now().toString(36);
  }

  var params = new URLSearchParams(window.location.search);
  var utms = {};
  var landingHasUtm = false;
  UTM_KEYS.forEach(function (k) {
    var v = params.get(k) || "";
    if (v) landingHasUtm = true;
    utms[k] = v;
  });
  try {
    if (landingHasUtm) {
      sessionStorage.setItem("_ftr_utm", JSON.stringify(utms));
    } else {
      var saved = sessionStorage.getItem("_ftr_utm");
      if (saved) {
        var parsed = JSON.parse(saved);
        UTM_KEYS.forEach(function (k) {
          if (!utms[k] && parsed[k]) utms[k] = parsed[k];
        });
      }
    }
  } catch (e) {}

  var screenRes = (screen.width || 0) + "x" + (screen.height || 0);
  var platform = navigator.platform || "";

  function send(evt) {
    evt.vid = vid;
    evt.session_id = sessionId;
    evt.url = window.location.href;
    evt.path = window.location.pathname;
    evt.referrer = document.referrer || "";
    evt.utm_source = utms.utm_source || "";
    evt.utm_medium = utms.utm_medium || "";
    evt.utm_campaign = utms.utm_campaign || "";
    evt.utm_term = utms.utm_term || "";
    evt.utm_content = utms.utm_content || "";
    evt.screen_res = screenRes;
    evt.platform = platform;

    var body = JSON.stringify(evt);
    // text/plain keeps this a "simple" CORS request (no preflight); the function parses JSON.
    var sent = false;
    if (navigator.sendBeacon && evt.event !== "pageview") {
      try {
        sent = navigator.sendBeacon(COLLECT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      } catch (e) {}
    }
    if (!sent) {
      fetch(COLLECT, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        keepalive: true,
        mode: "cors",
      }).catch(function () {});
    }
  }

  // Pageview
  send({ event: "pageview" });

  // Duration on hide
  var start = Date.now();
  function onLeave() {
    var secs = Math.round((Date.now() - start) / 1000);
    if (secs > 1 && secs < 1800) send({ event: "page_duration", seconds: secs });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") onLeave();
  });

  function classifyClick(a) {
    if (!a) return null;
    var href = (a.getAttribute("href") || "").trim();
    var id = (a.id || "").toLowerCase();
    var cls = (a.className || "").toString().toLowerCase();
    var text = (a.textContent || "").trim().toLowerCase();
    var download = a.hasAttribute("download");

    if (/^tel:/i.test(href)) return { label: "tel_phone", href: href };
    if (/^mailto:/i.test(href)) return { label: "mailto_email", href: href };
    if (/jotform\.com/i.test(href) || /#quote/.test(href) || id.indexOf("quote") >= 0 || text.indexOf("free bid") >= 0 || text.indexOf("quote") >= 0)
      return { label: "quote_form", href: href || "#quote" };
    if (download || /brochure|leave-behind|\.pdf($|\?)/i.test(href) || /brochure|download pdf/i.test(text) || /brochure/i.test(cls) || /brochure/i.test(id))
      return { label: "brochure", href: href };
    if (a.closest && a.closest(".nav-links, .site-header, header")) {
      var hash = href.replace(/^.*#/, "#");
      return { label: "nav_" + (hash.replace("#", "") || "home"), href: href };
    }
    if (href && href.charAt(0) !== "#" && !/^javascript:/i.test(href))
      return { label: "outbound_link", href: href };
    if (href.charAt(0) === "#") return { label: "anchor_" + href.slice(1), href: href };
    return null;
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t) return;
      var a = t.closest ? t.closest("a") : null;
      if (!a) {
        // primary CTAs that aren't anchors
        var btn = t.closest ? t.closest("button, .btn") : null;
        if (btn) {
          var bt = (btn.textContent || "").toLowerCase();
          if (bt.indexOf("bid") >= 0 || bt.indexOf("quote") >= 0) {
            send({ event: "click", click_label: "quote_cta", click_href: "#quote" });
          }
        }
        return;
      }
      var info = classifyClick(a);
      if (!info) return;
      send({ event: "click", click_label: info.label, click_href: (info.href || "").substring(0, 500) });
    },
    true
  );
})();
