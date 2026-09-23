/*
 * Clips: muted looping videos that play only while on screen.
 *
 *   [data-clips]              Container for one set of clips.
 *     video[data-clip]        Muted, looping clip (render with muted loop playsinline preload="none").
 *     button[data-clips-toggle]  Optional pause/play control for the set; rendered `hidden`
 *                             and revealed here, so it never shows without JavaScript.
 *
 * Clips never autoplay when the user prefers reduced motion; the toggle lets them opt in.
 * Without IntersectionObserver clips only play after the user presses the toggle.
 * No-op when the page has no [data-clips] containers.
 */
(function clips() {
  var sets = document.querySelectorAll("[data-clips]");
  if (!sets.length) return;

  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var hasIO = "IntersectionObserver" in window;

  Array.prototype.forEach.call(sets, function (set) {
    var videos = Array.prototype.slice.call(set.querySelectorAll("video[data-clip]"));
    if (!videos.length) return;
    var toggle = set.querySelector("[data-clips-toggle]");
    var paused = reduce.matches || !hasIO;
    var visible = new Set(hasIO ? [] : videos);

    videos.forEach(function (video) {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
    });

    function play(video) {
      var result = video.play();
      if (result && typeof result.catch === "function") result.catch(function () {});
    }

    function sync() {
      videos.forEach(function (video) {
        if (!paused && visible.has(video)) play(video);
        else if (!video.paused) video.pause();
      });
      if (toggle) toggle.textContent = paused ? "Play clips" : "Pause clips";
    }

    if (hasIO) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
          });
          sync();
        },
        { threshold: 0.5 }
      );
      videos.forEach(function (video) {
        observer.observe(video);
      });
    }

    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener("click", function () {
        paused = !paused;
        sync();
      });
    }

    if (typeof reduce.addEventListener === "function") {
      reduce.addEventListener("change", function () {
        if (reduce.matches) {
          paused = true;
          sync();
        }
      });
    }

    sync();
  });
})();
