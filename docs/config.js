// Orbit Desk website settings. Edit, push, and the site uses them after the next page load.
// (On a Raspberry Pi running the Python server, config.toml is used instead of this file.)
window.ORBIT_CONFIG = {
  // Your place: the clock, ISS passes over you, and the aurora verdict.
  location: {"name": "Kraków", "short": "KRK", "lat": 50.0614, "lon": 19.9366, "elevation_m": 220, "timezone": "Europe/Warsaw"},

  // Kp usually needed to see aurora from your latitude. About 7 for southern Poland.
  aurora_kp_threshold: 7,

  // "Watch Earth live" on the ISS screen: any embeddable stream, e.g.
  //   https://www.youtube.com/embed/VIDEO_ID?autoplay=1&mute=1
  //   https://www.youtube.com/embed/live_stream?channel=CHANNEL_ID&autoplay=1&mute=1
  iss_stream_url: "https://www.youtube.com/embed/M3HKLzjvKPc?autoplay=1&mute=1",

  // Webb pictures: searches in NASA's Image and Video Library, and how often the picture changes.
  gallery: {
    queries: ["Webb nebula", "Webb galaxy", "Webb NIRCam", "Webb MIRI"],
    year_start: 2022,
    rotate_minutes: 15,
    // skip photos of people and hardware that also mention Webb
    exclude_words: ["town hall", "engineer", "technician", "clean room", "cleanroom", "ceremony", "team", "administrator", "press", "visit", "mirror", "sunshield", "crane", "shipping"],
  },

  // One station per row. `search` is looked up in radio-browser.info; set `url` to pin a stream.
  // Use https streams: browsers won't play http audio on an https page.
  radio: [
    {"id": "gb", "country": "United Kingdom", "countrycode": "GB", "tz": "Europe/London", "name": "BBC Radio 2", "search": "BBC Radio 2"},
    {"id": "jp", "country": "Japan", "countrycode": "JP", "tz": "Asia/Tokyo", "name": "Shonan Beach FM", "search": "Shonan Beach FM"},
    {"id": "jp2", "country": "Japan 2", "countrycode": "JP", "tz": "Asia/Tokyo", "name": "R/a/dio", "search": "r/a/dio"},
    {"id": "us", "country": "USA", "countrycode": "US", "tz": "America/Los_Angeles", "name": "KEXP", "search": "KEXP"},
    {"id": "can", "country": "Canada", "countrycode": "CA", "tz": "America/Edmonton", "name": "CKUA Radio Network", "search": "CKUA Radio Network"},
    {"id": "nl", "country": "Netherlands", "countrycode": "NL", "tz": "Europe/Amsterdam", "name": "NPO Radio 2", "search": "NPO Radio 2"},
    {"id": "is", "country": "Iceland", "countrycode": "IS", "tz": "Atlantic/Reykjavik", "name": "Bylgjan", "search": "Bylgjan"},
    {"id": "aus", "country": "Australia", "countrycode": "AU", "tz": "Australia/Sydney", "name": "Double J", "search": "Double J"},
  ],

  // Colour themes under Display > Look. Colours are any CSS colour.
  themes: [
    {"id": "solar", "name": "Solar", "bg": "#070B14", "panel": "#0E1524", "line": "#1E2A40", "text": "#E8ECF4", "muted": "#8591A8", "accent": "#F5A524", "accent2": "#45D0B0", "warn": "#FFC857", "crit": "#FF5A5F", "good": "#45D0B0", "land": "#16223A"},
    {"id": "martian", "name": "Martian Dust", "bg": "#140C08", "panel": "#1F130C", "line": "#3B2416", "text": "#F4E4D4", "muted": "#A88468", "accent": "#FF4500", "accent2": "#EAB308", "warn": "#EAB308", "crit": "#FF6B4A", "good": "#EAB308", "land": "#2B1A10"},
    {"id": "night", "name": "Observatory", "bg": "#000000", "panel": "#0B0B0D", "line": "#1F1F24", "text": "#E6E6E6", "muted": "#8A8A92", "accent": "#B35F00", "accent2": "#0B8069", "warn": "#D98A1A", "crit": "#D9483B", "good": "#0B8069", "land": "#141418", "image_filter": "none"},
  ],

  // Optional: where the "Orbit Desk" logo links, e.g. your GitHub repository.
  site: { repo_url: "" },
};
