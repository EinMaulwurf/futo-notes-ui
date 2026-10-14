// Modified FUTO editor host: forwards native bridge events to our browser UI.
window.futoBridge = {
  postMessage(json) {
    window.parent.postMessage(
      { source: 'futo-editor', message: JSON.parse(json) },
      window.location.origin,
    );
  },
};
