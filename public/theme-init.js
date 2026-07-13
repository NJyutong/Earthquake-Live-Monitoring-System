(function () {
  try {
    var hour = new Date().getHours();
    var theme = hour >= 8 && hour < 19 ? 'light' : 'dark';
    if (window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
      else if (window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
    }
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f7fb' : '#07111f');
  } catch (_error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
