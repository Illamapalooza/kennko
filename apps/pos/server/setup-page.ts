const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The one-time page a tablet opens to trust the till and install it as an app. Plain HTML: it must work before anything is trusted. */
export function setupPage(secureUrl: string | null, problem: string): string {
  const body = secureUrl
    ? `
    <p class="lead">Do this once on each tablet or phone. It takes about two minutes.</p>

    <section>
      <h2><span>1</span> Trust the till</h2>
      <p>The till talks to this device over a secure connection it makes itself. The device needs to be told to trust it.</p>
      <a class="btn" href="/kennko-pos.crt">Get the certificate</a>
      <details open>
        <summary>iPad or iPhone (use Safari)</summary>
        <ol>
          <li>Tap <b>Allow</b> when asked to download a profile.</li>
          <li>Open <b>Settings</b>. Tap <b>Profile Downloaded</b> near the top, then <b>Install</b>.</li>
          <li>Go to <b>Settings › General › About › Certificate Trust Settings</b> and switch on <b>Kennko POS (this shop only)</b>.</li>
        </ol>
      </details>
      <details>
        <summary>Android tablet or phone (use Chrome)</summary>
        <ol>
          <li>Let the file download.</li>
          <li>Open <b>Settings</b> and search for <b>CA certificate</b>. It is usually under <b>Security › Encryption &amp; credentials › Install a certificate</b>.</li>
          <li>Choose <b>CA certificate</b>, tap <b>Install anyway</b>, and pick the downloaded file <b>kennko-pos.crt</b>.</li>
        </ol>
      </details>
      <details>
        <summary>Mac or Windows computer</summary>
        <ol>
          <li><b>Mac:</b> open the file, add it to the <b>login</b> keychain, then open it in Keychain Access and set <b>Trust</b> to <b>Always Trust</b>.</li>
          <li><b>Windows:</b> open the file, choose <b>Install Certificate</b>, and place it in <b>Trusted Root Certification Authorities</b>.</li>
        </ol>
      </details>
    </section>

    <section>
      <h2><span>2</span> Open the secure address</h2>
      <a class="btn" href="${esc(secureUrl)}">${esc(secureUrl)}</a>
      <p class="small">If the browser shows a warning here, step 1 is not finished on this device.</p>
    </section>

    <section>
      <h2><span>3</span> Install it</h2>
      <ul>
        <li><b>iPad or iPhone:</b> tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>
        <li><b>Android or a computer:</b> tap <b>Install Kennko POS on this device</b> under the PIN pad.</li>
      </ul>
      <p>Kennko POS now opens from the home screen, full screen, like any other app.</p>
    </section>

    <p class="small">This certificate only works for addresses inside a local network. It cannot be used for websites on the internet.</p>`
    : `
    <p class="lead">The secure address is not running on the till computer, so this device cannot install the till as an app yet.</p>
    <p>${esc(problem || 'Ask whoever looks after the till computer to check it.')}</p>
    <p>The till still works in the browser at this address.</p>
    <a class="btn" href="/">Open the till</a>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0055ff">
<title>Set up Kennko POS</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-rounded, "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif; background: #0055ff; color: #0a1b4d; line-height: 1.5; }
  main { max-width: 620px; margin: 0 auto; padding: 28px 16px 48px; }
  h1 { color: #fff; font-size: 1.7rem; margin: 0 0 4px; }
  .lead { color: #fff; font-weight: 700; margin: 0 0 20px; }
  section { background: #fff; border-radius: 24px; padding: 20px; margin-bottom: 14px; }
  h2 { font-size: 1.15rem; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; }
  h2 span { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #ffb830; font-size: 1rem; }
  p { margin: 0 0 12px; }
  ol, ul { margin: 8px 0 4px; padding-left: 22px; }
  li { margin-bottom: 6px; }
  .btn { display: block; text-align: center; background: #0055ff; color: #fff; font-weight: 800; text-decoration: none; padding: 14px 16px; border-radius: 16px; margin: 4px 0 12px; word-break: break-all; }
  main > .btn { background: #fff; color: #0055ff; }
  details { border-top: 1px solid #dfe8ff; padding: 10px 0 2px; }
  summary { font-weight: 800; cursor: pointer; }
  .small { font-size: 0.88rem; opacity: 0.85; margin-bottom: 0; }
  main > p { color: #fff; }
</style>
</head>
<body>
<main>
  <h1>Set up Kennko POS</h1>
  ${body}
</main>
</body>
</html>
`
}
