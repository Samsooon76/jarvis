const configureSidePanel = async () => {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
};

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});
