(function() {
  "use strict";
  const STORAGE_KEY = "playerState";
  const STATE_VERSION = 2;
  const TRACK_FIELDS = [
    "id",
    "title",
    "artist",
    "audio_url",
    "cover_url",
    "filename",
    "cover_filename",
    "lyrics",
    "slug",
    "nickname",
    "user_id",
    "likes_count",
    "plays_count",
    "is_liked",
    "audio_available",
    "hidden"
  ];
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function safeParseJSON(raw) {
    if (!raw || typeof raw !== "string") {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Failed to parse stored player state:", error);
      return null;
    }
  }
  function sanitizeString(value) {
    return typeof value === "string" ? value : "";
  }
  function sanitizeTrack(track) {
    if (!isObject(track)) {
      return null;
    }
    const result = {};
    TRACK_FIELDS.forEach((field) => {
      if (track[field] !== void 0) {
        result[field] = track[field];
      }
    });
    if (typeof result.id !== "number") {
      const parsedId = Number.parseInt(result.id, 10);
      if (!Number.isNaN(parsedId)) {
        result.id = parsedId;
      } else {
        delete result.id;
      }
    }
    result.title = sanitizeString(result.title);
    result.artist = sanitizeString(result.artist);
    result.audio_url = sanitizeString(result.audio_url).trim();
    result.cover_url = sanitizeString(result.cover_url).trim();
    result.filename = sanitizeString(result.filename).trim();
    result.cover_filename = sanitizeString(result.cover_filename).trim();
    result.lyrics = sanitizeString(result.lyrics);
    result.slug = sanitizeString(result.slug).trim();
    result.nickname = sanitizeString(result.nickname).trim();
    result.audio_available = result.audio_available !== false && !!(result.audio_url || result.filename);
    if (!result.audio_url && !result.filename) {
      result.audio_available = false;
    }
    return result;
  }
  function sanitizeTracks(tracks) {
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks.map(sanitizeTrack).filter((track) => track && (track.id !== void 0 || track.audio_url || track.filename));
  }
  function normalizeState(input) {
    if (!isObject(input)) {
      return null;
    }
    const tracks = sanitizeTracks(input.tracks);
    const currentIndex = Number.isInteger(input.currentIndex) ? input.currentIndex : Number.parseInt(input.currentIndex, 10);
    const normalizedIndex = Number.isInteger(currentIndex) ? currentIndex : -1;
    const state = {
      version: STATE_VERSION,
      tracks,
      currentIndex: normalizedIndex >= 0 && normalizedIndex < tracks.length ? normalizedIndex : -1,
      isPlaying: !!input.isPlaying,
      currentTime: Number.isFinite(input.currentTime) ? Math.max(0, input.currentTime) : 0,
      volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(1, input.volume)) : 1,
      trackId: input.trackId ?? null,
      audioSrc: sanitizeString(input.audioSrc).trim()
    };
    if (state.currentIndex >= 0 && tracks[state.currentIndex] && tracks[state.currentIndex].id !== void 0) {
      state.trackId = tracks[state.currentIndex].id;
    } else if (!Number.isInteger(state.trackId)) {
      const parsedTrackId = Number.parseInt(state.trackId, 10);
      state.trackId = Number.isNaN(parsedTrackId) ? null : parsedTrackId;
    }
    if (!state.audioSrc && state.currentIndex >= 0) {
      const cur = tracks[state.currentIndex];
      if (cur?.audio_url) {
        state.audioSrc = cur.audio_url;
      } else if (cur?.filename) {
        state.audioSrc = `/uploads/${cur.filename}`;
      }
    }
    return state;
  }
  function read() {
    const state = normalizeState(safeParseJSON(localStorage.getItem(STORAGE_KEY)));
    if (!state) {
      return null;
    }
    return state;
  }
  function write(input) {
    const state = normalizeState(input);
    if (!state) {
      clear();
      return null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    } catch (error) {
      console.warn("Failed to persist player state:", error);
      return state;
    }
  }
  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to clear player state:", error);
    }
  }
  window.SwagPlayerState = {
    STORAGE_KEY,
    safeParseJSON,
    sanitizeTrack,
    sanitizeTracks,
    normalizeState,
    read,
    write,
    clear
  };
})();
