/*! Skyline 360 Park — site behaviour
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 */
(() => {
  // Page loader. Never wait for window.load (images/fonts/video) — that is what
  // made slow connections feel stuck. Deferred scripts already run after the
  // DOM is parsed, so lift on the next frame and hard-cap shortly after.
  const loader = document.getElementById("page-loader");
  if (loader) {
    const root = document.documentElement;
  const LOADER_MIN_MS = 80;
  const LOADER_CAP_MS = 280;
    const startedAt = performance.now();
    let lifted = false;

    const lift = () => {
      if (lifted) return;
      const remaining = LOADER_MIN_MS - (performance.now() - startedAt);
      const reveal = () => {
        if (lifted) return;
        lifted = true;
        root.classList.remove("is-loading");
        loader.classList.add("is-done");

        const retire = () => {
          loader.hidden = true;
          root.classList.remove("has-loader");
        };
        // the caption and bar fade faster and their events bubble, so wait for the
        // overlay's own fade rather than the first transition to finish
        const onFadeEnd = (event) => {
          if (event.target !== loader || event.propertyName !== "opacity") return;
          loader.removeEventListener("transitionend", onFadeEnd);
          retire();
        };
        loader.addEventListener("transitionend", onFadeEnd);
        window.setTimeout(retire, 800);
      };

      if (remaining > 0) window.setTimeout(reveal, remaining);
      else reveal();
    };

    requestAnimationFrame(lift);
    window.setTimeout(lift, LOADER_CAP_MS);
  }

  // Fill Location menus from the shared parks registry (keeps existing nav chrome/layout).
  const registry = window.SkylineParkRegistry;
  if (registry?.parks?.length) {
    const pathFile = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const pathWithQuery = pathFile + (location.search || "");
    const currentPark =
      registry.getPark?.(document.body?.dataset?.parkId) ||
      registry.getPark?.(document.querySelector("[data-park-hub]")?.dataset.parkId) ||
      registry.getParkByHref?.(pathWithQuery) ||
      registry.getParkByHref?.(pathFile);

    const fillLocationLinks = (container, { role } = {}) => {
      if (!container) return;
      const existing = container.querySelectorAll(
        'a[href*="location.html"], a[href*="location-"]'
      );
      if (!existing.length) return;
      container.innerHTML = registry.parks
        .map((park) => {
          const active = currentPark && currentPark.id === park.id;
          const roleAttr = role ? ` role="${role}"` : "";
          const activeAttr = active ? ` class="is-active" aria-current="page"` : "";
          return `<a href="${park.href}"${roleAttr}${activeAttr}>${park.name}</a>`;
        })
        .join("");
    };

    document.querySelectorAll(".nav-dropdown-inner").forEach((inner) => {
      fillLocationLinks(inner, { role: "menuitem" });
    });
    document.querySelectorAll(".mobile-dropdown-panel").forEach((panel) => {
      fillLocationLinks(panel);
    });
  }

  // Content booking CTAs always open the location finder first (never skip to a
  // saved park). Navbar / mobile-nav links are left alone.
  const GUIDE_HREF = "index.html?guide=1";
  const PENDING_PLAN_KEY =
    window.SkylineParkRegistry?.PENDING_PLAN_KEY || "skyline360_pending_plan";

  const isNavBookingLink = (link) =>
    Boolean(link.closest(".site-header, .mobile-nav, .nav-dropdown, .mobile-dropdown"));

  const isGuideBookingLink = (link) => {
    if (!link || isNavBookingLink(link)) return false;
    // Footer / stand-alone walk-in waiver — do not route through the location guide.
    if (link.hasAttribute("data-waiver-entry")) return false;
    if (
      link.hasAttribute("data-location-guide") ||
      link.hasAttribute("data-plan") ||
      link.hasAttribute("data-park-entry")
    ) {
      return true;
    }
    const href = link.getAttribute("href") || "";
    if (/waiver\.html\?[^#]*mode=walkin/i.test(href)) return false;
    if (/[?&]guide=1(?:&|#|$)/.test(href) || /#find-park\b/.test(href)) return true;
    if (/booking\.skyline360park\.com\/.*waiver/i.test(href)) return true;
    return false;
  };

  const planFromLink = (link) => {
    const explicit = String(link.getAttribute("data-plan") || "").trim().toLowerCase();
    if (explicit) return explicit;
    const href = link.getAttribute("href") || "";
    if (/kids|kids-family/i.test(href)) return "kids";
    if (/membership/i.test(href)) return "membership";
    if (/groups/i.test(href)) return "groups";
    if (/party/i.test(href)) return "party";
    if (/general/i.test(href)) return "general";
    return "";
  };

  const rememberPendingPlan = (planId) => {
    try {
      if (planId) {
        sessionStorage.setItem(
          PENDING_PLAN_KEY,
          JSON.stringify({ planId, at: Date.now() })
        );
      } else {
        sessionStorage.removeItem(PENDING_PLAN_KEY);
      }
      sessionStorage.removeItem("skyline360_guide_dismissed");
    } catch (_) {}
  };

  const applyLocationGuideLinks = () => {
    if (document.body?.dataset?.page === "waiver") return;

    const pagePark =
      document.body?.dataset?.parkId ||
      document.querySelector("[data-park-hub]")?.dataset.parkId ||
      "";
    if (pagePark) window.SkylineParkRegistry?.setSelectedParkId?.(pagePark);

    document.querySelectorAll("a[href]").forEach((link) => {
      if (!isGuideBookingLink(link)) return;
      const planId = planFromLink(link);
      if (planId && !link.hasAttribute("data-plan")) {
        link.setAttribute("data-plan", planId);
      }
      link.setAttribute("data-location-guide", "");
      link.setAttribute("href", GUIDE_HREF);
      link.removeAttribute("target");
    });
  };

  applyLocationGuideLinks();

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || !isGuideBookingLink(link)) return;

    const planId = planFromLink(link);

    rememberPendingPlan(planId);

    // Open the finder on this page — never bounce to home just to show the popup.
    event.preventDefault();
    const openGuide = () => {
      if (typeof window.SkylineOpenLocationGuide === "function") {
        window.SkylineOpenLocationGuide({
          planId,
          message: planId
            ? "Choose your Skyline park first. Next you will continue with that plan’s booking."
            : "Choose your Skyline park first so we send you to the right location.",
        });
        return true;
      }
      return false;
    };

    if (openGuide()) return;

    // Script still loading — retry briefly, then fall back to home finder.
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (openGuide() || tries > 40) {
        window.clearInterval(timer);
        if (tries > 40 && typeof window.SkylineOpenLocationGuide !== "function") {
          window.location.href = GUIDE_HREF;
        }
      }
    }, 50);
  });

  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const mobileNav = document.querySelector(".mobile-nav");

  if (toggle && mobileNav) {
    toggle.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
      if (!open) {
        mobileNav.querySelectorAll(".mobile-dropdown.is-open").forEach((el) => {
          el.classList.remove("is-open");
          const btn = el.querySelector(".mobile-dropdown-toggle");
          if (btn) btn.setAttribute("aria-expanded", "false");
        });
      }
    });

    mobileNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileNav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      });
    });
  }

  // Desktop Location dropdown — hover + click (stable across all pages)
  document.querySelectorAll(".nav-item.has-dropdown").forEach((item) => {
    const btn = item.querySelector(".nav-dropdown-toggle");
    if (!btn) return;
    let closeTimer = null;

    const openMenu = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      document.querySelectorAll(".nav-item.has-dropdown.is-open").forEach((other) => {
        if (other !== item) {
          other.classList.remove("is-open");
          const otherBtn = other.querySelector(".nav-dropdown-toggle");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
        }
      });
      item.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
    };

    const scheduleClose = () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        item.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
        closeTimer = null;
      }, 160);
    };

    item.addEventListener("mouseenter", openMenu);
    item.addEventListener("mouseleave", scheduleClose);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.classList.contains("is-open")) {
        item.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      } else {
        openMenu();
      }
    });

    item.querySelectorAll(".nav-dropdown a").forEach((link) => {
      link.addEventListener("click", () => {
        item.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      });
    });
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".nav-item.has-dropdown")) return;
    document.querySelectorAll(".nav-item.has-dropdown.is-open").forEach((item) => {
      item.classList.remove("is-open");
      const btn = item.querySelector(".nav-dropdown-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".nav-item.has-dropdown.is-open").forEach((item) => {
      item.classList.remove("is-open");
      const btn = item.querySelector(".nav-dropdown-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  });

  // Mobile Location accordion
  document.querySelectorAll(".mobile-dropdown-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".mobile-dropdown");
      if (!wrap) return;
      const willOpen = !wrap.classList.contains("is-open");
      document.querySelectorAll(".mobile-dropdown.is-open").forEach((other) => {
        if (other !== wrap) {
          other.classList.remove("is-open");
          const otherBtn = other.querySelector(".mobile-dropdown-toggle");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
        }
      });
      wrap.classList.toggle("is-open", willOpen);
      btn.setAttribute("aria-expanded", String(willOpen));
    });
  });

  // Sticky header: solid blue once hero is no longer under the nav
  if (header && header.classList.contains("is-over-hero")) {
    const hero = document.querySelector(".hero");
    const syncHeader = () => {
      let scrolled = window.scrollY > 24;
      if (hero) {
        const bottom = hero.getBoundingClientRect().bottom;
        scrolled = bottom <= header.offsetHeight + 8;
      }
      header.classList.toggle("is-scrolled", scrolled);
    };
    syncHeader();
    window.addEventListener("scroll", syncHeader, { passive: true });
    window.addEventListener("resize", syncHeader);
  }

  // Scroll reveals
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -36px 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  // Duplicate marquee content for seamless loop
  document.querySelectorAll(".marquee-track").forEach((track) => {
    if (track.dataset.cloned) return;
    track.innerHTML = track.innerHTML + track.innerHTML;
    track.dataset.cloned = "1";
  });

  // Carousels
  document.querySelectorAll("[data-carousel]").forEach((root) => {
    const track = root.querySelector(".carousel-track");
    const slides = [...root.querySelectorAll(".slide")];
    const dotsWrap = root.querySelector(".carousel-dots");
    const prev = root.querySelector(".carousel-btn.prev");
    const next = root.querySelector(".carousel-btn.next");
    if (!track || slides.length === 0) return;

    let index = 0;
    let timer;

    const go = (i) => {
      index = (i + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      if (dotsWrap) {
        [...dotsWrap.children].forEach((d, di) => {
          d.classList.toggle("is-active", di === index);
        });
      }
    };

    if (dotsWrap) {
      slides.forEach((_, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-label", `Go to slide ${i + 1}`);
        if (i === 0) b.classList.add("is-active");
        b.addEventListener("click", () => {
          go(i);
          restart();
        });
        dotsWrap.appendChild(b);
      });
    }

    prev?.addEventListener("click", () => {
      go(index - 1);
      restart();
    });
    next?.addEventListener("click", () => {
      go(index + 1);
      restart();
    });

    const restart = () => {
      clearInterval(timer);
      timer = setInterval(() => go(index + 1), 4200);
    };

    go(0);
    restart();

    root.addEventListener("mouseenter", () => clearInterval(timer));
    root.addEventListener("mouseleave", restart);
  });

  // Soft 3D tilt on media panels
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) {
    document.querySelectorAll("[data-tilt]").forEach((el) => {
      const onMove = (e) => {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const rx = (0.5 - y) * 8;
        const ry = (x - 0.5) * 10;
        el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      };
      const onLeave = () => {
        el.style.transform = "";
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);
    });
  }

  // Contact form (client-side only)
  const form = document.querySelector("[data-contact-form]");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const status = form.querySelector(".form-status");
      const hp = form.querySelector(".hp-field input");
      if (hp && hp.value) return;
      if (status) {
        status.textContent = "Lorem ipsum — message received (demo only).";
        status.classList.add("is-visible");
      }
      form.reset();
    });
  }

  // FAQ accordion — one open at a time in the 2-column grid
  document.querySelectorAll("[data-faq-accordion]").forEach((grid) => {
    const items = grid.querySelectorAll("details.faq-card");
    items.forEach((item) => {
      item.addEventListener("toggle", () => {
        if (!item.open) return;
        items.forEach((other) => {
          if (other !== item) other.open = false;
        });
      });
    });
  });

  // Start Google Maps embeds as soon as the page opens so they are ready
  // when the guest scrolls to Hours / Contact — do not wait for the viewport.
  const warmMapFrames = () => {
    document.querySelectorAll(".map-frame").forEach((frame) => {
      frame.classList.add("is-loading");
    });
    document.querySelectorAll("iframe[data-src]").forEach((iframe) => {
      const src = iframe.dataset.src;
      if (!src) return;
      const current = iframe.getAttribute("src") || "";
      if (!current || current === "about:blank") {
        iframe.setAttribute("src", src);
      }
      iframe.setAttribute("loading", "eager");
      const markReady = () => {
        iframe.closest(".map-frame")?.classList.remove("is-loading");
        iframe.closest(".map-frame")?.classList.add("is-ready");
      };
      iframe.addEventListener("load", markReady, { once: true });
      // If the embed was already cached, load may have fired before we listened.
      window.setTimeout(() => {
        try {
          if (iframe.contentWindow) markReady();
        } catch (_) {
          markReady();
        }
      }, 2500);
    });
  };
  warmMapFrames();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warmMapFrames, { timeout: 400 });
  } else {
    window.setTimeout(warmMapFrames, 0);
  }

  // Hero video: poster is LCP, then the same full-quality clip fades in.
  // Only Save-Data / reduced-motion skip playback — never a lower-quality file.
  document.querySelectorAll(".hero-video").forEach((video) => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const saveData = Boolean(conn?.saveData);

    if (reduceMotion || saveData) {
      video.removeAttribute("src");
      video.removeAttribute("autoplay");
      video.preload = "none";
      return;
    }

    const mobile = window.matchMedia("(max-width: 809.98px)").matches;
    const src = mobile
      ? video.dataset.srcMobile || video.dataset.srcDesktop
      : video.dataset.srcDesktop || video.dataset.srcMobile;
    if (!src) return;

    const startVideo = () => {
      if (document.hidden) {
        document.addEventListener("visibilitychange", startVideo, { once: true });
        return;
      }

      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.loop = true;
      video.setAttribute("muted", "");
      video.setAttribute("autoplay", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("loop", "");
      video.classList.add("is-loading");

      let wrapping = false;
      const attemptPlay = () => {
        if (!video.src) return;
        video.loop = true;
        video.setAttribute("loop", "");
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
      };

      const restartSeamless = () => {
        // Instant wrap: jump to start and keep playing so guests never see a stop.
        if (wrapping) return;
        wrapping = true;
        try {
          video.currentTime = 0;
        } catch (_) {}
        attemptPlay();
        window.setTimeout(() => {
          wrapping = false;
        }, 180);
      };

      const reveal = () => {
        video.classList.remove("is-loading");
        video.classList.add("is-ready");
      };

      // A missing or unplayable file must leave the poster untouched rather
      // than fading in an empty box over it.
      video.addEventListener(
        "error",
        () => {
          video.classList.remove("is-loading", "is-ready");
        },
        { once: true }
      );

      video.addEventListener("loadeddata", reveal, { once: true });
      video.addEventListener("canplay", reveal, { once: true });
      video.addEventListener("playing", reveal, { once: true });
      video.addEventListener("canplay", attemptPlay, { once: true });
      video.addEventListener("loadeddata", attemptPlay, { once: true });

      // Native loop + fallbacks for browsers that drop out at the end.
      video.addEventListener("ended", restartSeamless);
      video.addEventListener("pause", () => {
        if (document.hidden || !video.src || wrapping) return;
        const dur = video.duration;
        // Paused at/near the end → treat as a failed loop and restart now.
        if (Number.isFinite(dur) && dur > 0 && video.currentTime >= dur - 0.35) {
          restartSeamless();
        }
      });

      // Near the end, soft-wrap before some mobiles freeze on the last frame.
      video.addEventListener("timeupdate", () => {
        const dur = video.duration;
        if (!Number.isFinite(dur) || dur < 1 || wrapping) return;
        if (video.currentTime >= dur - 0.08) restartSeamless();
      });

      // Tab switching can leave the clip paused mid-way through.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && video.paused && video.src) attemptPlay();
      });

      // If playback ever stalls while visible, nudge it quietly.
      window.setInterval(() => {
        if (document.hidden || !video.src || wrapping) return;
        if (video.paused) attemptPlay();
      }, 4000);

      // Mobile browsers that refuse muted autoplay -- iOS in Low Power Mode,
      // some Edge and in-app browsers -- start on the first interaction
      // instead, so the hero is never stuck on the still image. touchend and
      // click are here because WebKit counts those as the user gesture that
      // permits playback, and never counts scrolling.
      const playOnGesture = () => {
        if (video.paused) attemptPlay();
      };
      ["pointerdown", "touchstart", "touchend", "click", "keydown", "scroll"].forEach((name) => {
        window.addEventListener(name, playOnGesture, { once: true, passive: true });
      });

      // Reveal is driven by having a frame, not by playback: the video is
      // transparent until revealed, and a browser that declines to play an
      // element it treats as invisible would otherwise deadlock against a
      // reveal that waits for "playing".
      window.setTimeout(() => {
        if (video.readyState >= 2) reveal();
      }, 2500);

      video.preload = "metadata";
      video.src = src;
      video.load();
      attemptPlay();
    };

    const whenIdle = (fn) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(fn, { timeout: 1800 });
      } else {
        window.setTimeout(fn, 700);
      }
    };

    whenIdle(startVideo);
  });
})();

// Signature. Kept in the console rather than on the page so it reaches whoever
// looks under the hood without putting a second credit in front of visitors.
(() => {
  console.log(
    "%c SE %c Skyline 360 Park — design & front-end by Steve Ubangha Ewa %c https://nazarng.com/steve.html",
    "background:linear-gradient(135deg,#4a1f7a,#ff7a00);color:#fff;font-weight:700;padding:2px 5px;border-radius:3px",
    "color:#4a1f7a;font-weight:600",
    "color:#8a8394"
  );
})();
