// The manifest for each browser, from probe/manifest.json, which is Opera's. Opera shows the panel through its own
// `sidebar_action`; Chrome and Edge have no such key, and show it as a side panel that the toolbar button opens
// (`chrome.sidePanel`, from Chromium 114; `setPanelBehavior()` from 116). Pure.

export const TARGETS = ['opera', 'chrome', 'edge'];

export function manifestFor(base, target) {
  if (target === 'opera') return base;
  const { sidebar_action: sidebar, ...rest } = base;
  return {
    ...rest,
    minimum_chrome_version: '116',
    permissions: [...rest.permissions, 'sidePanel'],
    action: { default_title: sidebar.default_title, default_icon: sidebar.default_icon },
    side_panel: { default_path: sidebar.default_panel },
  };
}
