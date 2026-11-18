# Shop setup: Windows tablet and Wanbo projector

The Windows tablet at the counter is the till: it runs the POS and the wall's server, and staff use the POS on its
screen. The Wanbo projector only opens the wall page in its browser, over the shop wifi. Nothing runs in the cloud,
so selling keeps working when the internet is down.

```
 Windows tablet (counter)                       Wanbo projector
 ├─ POS server   :4466  ◄── POS app on this screen
 ├─ POS, secure  :4443  ◄── other tablets/phones (optional)
 └─ wall server  :4455  ◄────── shop wifi ──────  browser: http://<tablet>:4455/
```

## First time (about 15 minutes, needs internet)

1. **Install Git and Node.js.** Open **Terminal** (or PowerShell) and run:

   ```
   winget install --id Git.Git -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```

   Close the window afterwards so the next one picks them up.

2. **Get the code.** Open a new Terminal and run:

   ```
   cd $HOME
   git clone https://github.com/Illamapalooza/kennko.git
   ```

3. **Run the setup.** In File Explorer open `kennko\deploy\windows` and double-click **`setup.cmd`**. Allow it to
   make changes when Windows asks. It asks for the staff PIN, the manager PIN and an optional second backup folder,
   then builds and starts everything.

4. **Install the POS app on the tablet.** Open **Microsoft Edge** at `http://localhost:4466/` and tap
   **Install Kennko POS on this device** under the PIN pad. It now opens from the Start menu like any app. To have it
   open by itself at sign-in: in Edge go to `edge://apps`, open Kennko POS's details, and turn on
   **Start app when you sign in**.

5. **Show the wall on the projector.** In the Wanbo's browser open the address the setup printed,
   `http://<tablet address>:4455/`, and press OK on the big button once (music and full screen).

6. **Fix the tablet's address** so the projector's bookmark keeps working: in the shop router, reserve the tablet's
   current IP address (often called *DHCP reservation* or *static lease*).

## Every day

Nothing to start. Turn the tablet on, sign in to Windows, and the POS and the wall start by themselves within a
minute. Turn the projector on and open the wall bookmark.

- Keep the tablet **plugged in**. Setup stops it from sleeping while charging; on battery Windows may still put it
  to sleep, which pauses the till and the wall.
- Don't press the tablet's power button during opening hours: that puts it to sleep too.
- If the wall shows old orders or "can't reach the till", the tablet is asleep or off the wifi.

## Updating

```
cd $HOME\kennko
git pull
```

Then double-click `deploy\windows\setup.cmd` again. It keeps the PINs and the sales, rebuilds, and restarts. The
installed POS app picks up the new version the next time it is opened.

## If something is wrong

| Problem | Where to look |
|---|---|
| POS app says it can't reach the till | `apps\pos\data\logs\pos.log` |
| Wall is blank or frozen | `apps\pos\data\logs\wall.log` |
| Projector can't open the wall | Tablet and projector on the same wifi? Windows calls that network **Private**? (setup sets it) |
| Change a PIN | Edit `apps\pos\config.json` in Notepad, then restart the tablet |

The POS and the wall are the tasks **Kennko POS** and **Kennko Wall** in Task Scheduler. Each one restarts the
program five seconds after it stops.

Sales are in `apps\pos\data\pos.db`, with a copy per day in `apps\pos\data\backups` (and in the second backup folder,
if one was set). See `apps/pos/README.md` for restoring one.

## The projector

Wanbo models differ. If yours has no browser, install one from its app store (a TV browser such as *TV Bro*). If it
can't run one at all, connect the tablet to the projector with HDMI, or with *Cast* (Windows key + K) set to
**Extend**, and drag an Edge window showing `http://localhost:4455/` onto the projector screen.
