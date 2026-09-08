// MV3 can wake this module for an action. Register synchronously, without any
// page, storage or editor dependency. The clicked tab's URL is never used.
chrome.action.onClicked.addListener(async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  } catch {
    console.error('Foil could not open an editor tab. Try the toolbar button again.');
  }
});
