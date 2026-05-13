const configureSidePanel = async () => {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
};

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  console.log("Jarvis extension installed");
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});
