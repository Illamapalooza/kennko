export async function handleWallUpdate(button) {
  const plugin = window.Capacitor?.Plugins?.KennkoUpdate;
  if (!plugin) {
    button.textContent = "Updates only in Android app";
    return;
  }

  button.disabled = true;
  button.textContent = "Checking for update…";
  try {
    const res = await plugin.check();
    if (!res.available) {
      button.textContent = "Up to date";
      button.disabled = false;
      return;
    }

    button.textContent = `Install update ${res.versionName}`;
    button.disabled = false;
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "Downloading update…";
      try {
        const out = await plugin.install();
        if (out.error) {
          button.textContent = out.error;
          button.disabled = false;
        }
      } catch {
        button.textContent = "The update did not install. Try again, or ask Julius.";
        button.disabled = false;
      }
    };
  } catch {
    button.textContent = "Could not check for updates";
    button.disabled = false;
  }
}
