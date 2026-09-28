const vscode = require('vscode');

function activate() {
  const channel = new BroadcastChannel('helena-code-theme');
  let pending = Promise.resolve();

  channel.onmessage = ({ data }) => {
    if (data?.type !== 'theme' || (data.mode !== 'dark' && data.mode !== 'light')) return;
    pending = pending.then(async () => {
      const configuration = vscode.workspace.getConfiguration('workbench');
      const selected = configuration.inspect('colorTheme')?.globalValue;
      if (selected && selected !== 'Helena Dark' && selected !== 'Helena Light') return;
      for (const key of ['preferredDarkColorTheme', 'preferredLightColorTheme']) {
        const preferred = configuration.inspect(key)?.globalValue;
        if (preferred && preferred !== 'Helena Dark' && preferred !== 'Helena Light') return;
      }
      const windowConfiguration = vscode.workspace.getConfiguration('window');
      if (windowConfiguration.get('autoDetectColorScheme')) {
        await windowConfiguration.update('autoDetectColorScheme', false, vscode.ConfigurationTarget.Global);
      }
      const theme = data.mode === 'light' ? 'Helena Light' : 'Helena Dark';
      if (configuration.get('colorTheme') !== theme) {
        await configuration.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
      }
    }).catch((error) => console.error('Helena theme sync failed', error));
  };

  channel.postMessage({ type: 'ready' });
  return { dispose: () => channel.close() };
}

exports.activate = activate;
