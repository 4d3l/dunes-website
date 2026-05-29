# Dunes Secure Messenger Website

This repository contains the source code for the official showcase website of **Dunes Secure Messenger** (`dunes.chat`). It is a highly responsive, modern landing page with a bespoke "Dunes" desert aesthetic.

## Features

- **Responsive Mobile-First Design**: Optimized beautifully for widescreen monitors, standard laptops, tablets, and smartphones.
- **Glassmorphic App Chat Mockup**: Visualizes the actual Dunes messaging UI flow with transparent bubble nodes and encrypted metadata tags.
- **Interactive Cryptography Simulator**: High-fidelity, real-time client demonstration showing Diffie-Hellman key exchanges and symmetric AES-256-GCM message sealing before transmission.
- **Security Architecture Highlight**: Deep dive into the zero-metadata, SIM-free privacy stack.
- **Sideloading Support Hub**: Complete step-by-step guideline assisting Android users on installing direct APK binaries.
- **Custom Domain Bind**: Built-in `CNAME` for instant custom routing on GitHub Pages.

---

## Brand Colors Used (Dunes theme)
- **Primary BG**: `#0D1117`
- **Secondary BG**: `#161B22`
- **Branding Accent**: `#F5A623` (Sand Dunes Amber)
- **Gradients**: Linear gradient from `#F5A623` to `#E8722A`

---

## Local Development & Testing

Since this website is built with highly optimized Vanilla HTML5, CSS3, and modern ES6 JavaScript, it has **zero build step bloat** and is instantly ready to run locally!

To avoid CORS restrictions when loading localized modules, run a simple local static server:

### Option A: Using Node.js (Recommended)
If you have Node.js installed, run:
```bash
# Install static server globally
npm install -g http-server

# Spin it up in the repository directory
http-server .
```
Open `http://localhost:8080` in your web browser.

### Option B: Python
If you prefer Python, run:
```bash
python -m http.server 8080
```
Open `http://localhost:8080` in your web browser.

---

## Deployment to GitHub Pages

To deploy this site onto your GitHub account using the custom domain `dunes.chat`, follow these instructions:

### Step 1: Create a New Repository on GitHub
Create a new public repository on your GitHub account named **`dunes-website`** (or any name you prefer). Keep it empty (do not add a README, license, or .gitignore).

### Step 2: Push the Local Repository to GitHub
Run the following commands in your shell within this directory to sync the code and deploy:

```bash
# 1. Stage all created files
git add .

# 2. Record initial commit
git commit -m "Initial commit: launch beautiful dunes-themed website with interactive E2EE simulator"

# 3. Add your remote GitHub URL (Replace USERNAME with your actual GitHub username)
git remote add origin https://github.com/USERNAME/dunes-website.git

# 4. Push to primary branch
git push -u origin main
```

### Step 3: Enable GitHub Pages in Repository Settings
1. Go to your repository on GitHub.com and open the **Settings** tab.
2. Under the left menu, click on **Pages**.
3. Under "Build and deployment", set the source to **"Deploy from a branch"**.
4. Set the branch to **`main`** and the folder to **`/ (root)`**, then click **Save**.
5. Ensure the **"Custom domain"** field has loaded `dunes.chat` (the site automatically registers this from our `CNAME` file).
6. Enable **"Enforce HTTPS"** for absolute transport layer protection.

*Your site will be fully operational at **https://dunes.chat** within a few minutes!*
