/*! Skyline 360 Park — shared location page filler
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 *
 *  Reads ?id= from the URL and fills location.html from SkylineParkRegistry.
 *  Optional media (video / gallery) only appears when that park has the data.
 */
(() => {
  const registry = window.SkylineParkRegistry;
  if (!registry?.parks?.length) return;

  const params = new URLSearchParams(window.location.search);
  let parkId = (params.get("id") || "").trim().toLowerCase();

  if (!parkId) {
    parkId = registry.parks[0]?.id || "";
    if (parkId) {
      const url = new URL(window.location.href);
      url.searchParams.set("id", parkId);
      window.history.replaceState({}, "", url.toString());
    }
  }

  const park = registry.getPark(parkId);
  if (!park) {
    window.location.replace("index.html?guide=1");
    return;
  }

  registry.setSelectedParkId?.(park.id);

  const hub = document.querySelector("[data-park-hub]");
  if (hub) hub.dataset.parkId = park.id;

  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el && value != null) el.textContent = value;
  };

  const statusOpen = park.status === "open";
  const statusLabel = park.statusLabel || (statusOpen ? "Now Open" : "Opening Soon");
  const statusYear = park.statusYear || (statusOpen ? "" : "(2026)");
  const lead =
    park.lead ||
    (statusOpen
      ? `Welcome to Skyline 360 Park in ${park.name || park.city}. Choose a plan below to get started.`
      : `Something big is landing in ${park.name || park.city}. Be first to know when doors open — thrills, parties, and 360° of fun are on the way.`);

  document.title = `${park.name} | ${statusLabel}${statusYear ? " " + statusYear : ""} | Skyline 360 Park`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) {
    desc.setAttribute(
      "content",
      park.description ||
        `Skyline 360 Park — ${park.name}. ${park.address || ""} ${statusLabel}.`
    );
  }

  const soonPage = document.querySelector(".soon-page");
  if (soonPage) {
    soonPage.setAttribute(
      "aria-label",
      `${park.name} ${statusOpen ? "location" : "opening soon"}`
    );
  }

  setText("[data-park-name]", park.name);
  setText("[data-park-status-label]", statusLabel);
  setText("[data-park-status-year]", statusYear);
  setText("[data-park-lead]", lead);
  setText("[data-park-eyebrow]", `Your park · ${park.name}`);

  const yearEl = document.querySelector("[data-park-status-year]");
  if (yearEl) yearEl.hidden = !statusYear;

  // Hero background image (optional per park)
  const hero = park.hero || {};
  const heroImg = document.querySelector("[data-park-hero-img]");
  const heroSource = document.querySelector("[data-park-hero-webp]");
  if (heroImg && hero.jpg) {
    heroImg.src = hero.jpg;
    if (hero.srcsetJpg) heroImg.srcset = hero.srcsetJpg;
  }
  if (heroSource && hero.webpSrcset) {
    heroSource.srcset = hero.webpSrcset;
  }

  // Optional media block — only for parks that define video/gallery
  const mediaSection = document.querySelector("[data-park-media]");
  const videoWrap = document.querySelector("[data-park-video-wrap]");
  const galleryWrap = document.querySelector("[data-park-gallery-wrap]");
  const hasVideo = Boolean(park.video);
  const hasGallery = Array.isArray(park.gallery) && park.gallery.length > 0;

  if (mediaSection && (hasVideo || hasGallery)) {
    mediaSection.hidden = false;

    if (videoWrap && hasVideo) {
      videoWrap.hidden = false;
      const video = videoWrap.querySelector("video");
      if (video) {
        video.src = park.video;
        if (park.videoPoster) video.setAttribute("poster", park.videoPoster);
        video.load();
        const play = () => {
          const p = video.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        };
        video.addEventListener("loadeddata", play, { once: true });
      }
    } else if (videoWrap) {
      videoWrap.hidden = true;
    }

    if (galleryWrap && hasGallery) {
      galleryWrap.hidden = false;
      const track = galleryWrap.querySelector("[data-park-gallery-track]");
      if (track) {
        track.innerHTML = park.gallery
          .map((item) => {
            const src = typeof item === "string" ? item : item.src;
            const alt = typeof item === "string" ? park.name : item.alt || park.name;
            return `<div class="slide"><img src="${src}" alt="${alt}" loading="lazy" decoding="async"></div>`;
          })
          .join("");
      }
    } else if (galleryWrap) {
      galleryWrap.hidden = true;
    }
  } else if (mediaSection) {
    mediaSection.hidden = true;
  }

  // Mark this document for any other scripts
  document.body.dataset.parkId = park.id;
})();
