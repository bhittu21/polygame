# POLY ARENA — Deployment Guide (Hostinger Cloud Startup)

## What you have
- Node.js FPS game (Three.js + Socket.io)
- Folder: `polyfps/` with server.js + public/

---

## Step-by-Step Deployment

### 1. Upload your files

**Option A — via FTP (FileZilla etc.)**
1. In Hostinger hPanel → Files → FTP Accounts, create an FTP user
2. Connect with FileZilla: host = your domain, port 21
3. Upload the entire `polyfps/` folder to `/home/user/domains/yourdomain.com/` or wherever hPanel points Node apps

**Option B — via hPanel File Manager**
1. hPanel → Files → File Manager
2. Navigate to your Node.js app root
3. Upload all files (drag and drop the polyfps folder contents)

---

### 2. Set up Node.js in hPanel

1. hPanel → **Node.js** (look in the "Advanced" or "Hosting" section)
2. Click **"Create Application"** or **"Manage"**
3. Set:
   - **Node.js version**: 18.x or 20.x (latest LTS)
   - **Application root**: path to your uploaded folder (e.g. `/polyfps`)
   - **Application startup file**: `server.js`
   - **Application URL**: your domain or subdomain
4. Click **Save / Create**

---

### 3. Install dependencies

In hPanel → Node.js → your app → click **"Open Terminal"** (or SSH in):

```bash
cd /path/to/your/polyfps
npm install
```

This installs express and socket.io (~30 seconds).

---

### 4. Start the application

In hPanel → Node.js → click **"Start"** or **"Restart"**

The game will run on the port Hostinger assigns automatically via `process.env.PORT`.

---

### 5. Test it

Open `https://yourdomain.com` in a browser.
- You should see the POLY ARENA start screen
- Enter a name and click PLAY
- Open another browser tab / share with friends to test multiplayer

---

## Controls (tell players this)

| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Aim |
| Left Click | Shoot (hold for auto) |
| TAB | Scoreboard |
| Escape | Release mouse |
| Click game | Capture mouse (required to aim) |

---

## Troubleshooting

**Game loads but multiplayer doesn't work**
→ Make sure Hostinger isn't blocking WebSockets. Cloud Startup supports them, but check if your Node.js app is actually running.

**502 Bad Gateway**
→ App isn't running. Go to hPanel → Node.js → Restart

**Port issues**
→ Don't hardcode a port. The code uses `process.env.PORT || 3000` which is correct.

**npm install fails**
→ Make sure you're in the right directory. Run `ls` to confirm `package.json` is there.

---

## If you want to share with people immediately before deploying

Run locally on your PC:
```bash
npm install
node server.js
```
Then use **ngrok** (ngrok.com — free) to create a public URL:
```bash
ngrok http 3000
```
Share the ngrok URL. This is the fastest way to show it in class.
