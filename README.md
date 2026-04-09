# Camelback Home Group — Landing Page

Single-page marketing website for Camelback Home Group, a Phoenix-area real estate brokerage with embedded legal professionals.

## Tech Stack

- Plain HTML, CSS, vanilla JavaScript (no frameworks)
- Single `index.html` with all styles and scripts inline
- Hosted on Netlify with Netlify Forms for contact submissions

---

## Customization Guide

### Swap in the Real Logo

1. Place your logo file in `assets/logo/` (e.g., `assets/logo/logo.png`)
2. In `index.html`, search for `LOGO PLACEHOLDER`
3. Replace the `<div class="nav-logo-mark">C</div>` with:
   ```html
   <img src="assets/logo/logo.png" alt="Camelback Home Group" class="nav-logo-img">
   ```
4. Do the same for the footer logo (search for `footer-brand-mark`)

### Update Contact Information

Search `index.html` for `555-0100` to find all phone number instances. Update:
- Hero / contact section phone number
- Footer phone number
- Email addresses (`info@camelbackhomegroup.com`)

### Update Testimonials

Search for `testimonial-card` in `index.html`. Each testimonial card contains:
- Quote text (`.testimonial-text`)
- Avatar initials (`.testimonial-avatar`)
- Name (`.testimonial-name`)
- Detail line (`.testimonial-detail`)

### Connect a Different Form Backend

The contact form uses Netlify Forms. To switch to a different backend:

1. Remove `data-netlify="true"` from the `<form>` tag
2. Remove the hidden `form-name` input
3. Update the form's `action` attribute to your endpoint
4. Add any required JavaScript for your form service (e.g., Formspree, SendGrid)

### Add Google Analytics

Add this snippet inside the `<head>` tag, before the closing `</head>`:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

Replace `G-XXXXXXXXXX` with your actual Measurement ID.

---

## Netlify Deployment

### Option A: GitHub + Netlify (Recommended)

1. Push this repo to GitHub
2. Go to [app.netlify.com](https://app.netlify.com)
3. Click **"Add new site" → "Import an existing project"**
4. Select your GitHub repository
5. Build settings:
   - **Build command:** (leave blank)
   - **Publish directory:** `.`
6. Click **Deploy site**

### Option B: Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir=.
```

### Set Up Form Notifications

1. In Netlify dashboard, go to **Site settings → Forms**
2. Verify the "contact" form appears
3. Go to **Forms → Form notifications**
4. Add an **Email notification** for new submissions
5. Enter the email address where you want to receive submissions

### Add a Custom Domain

1. In Netlify dashboard, go to **Domain settings**
2. Click **Add custom domain**
3. Enter your domain (e.g., `camelbackhomegroup.com`)
4. Update your domain's DNS:
   - Point your domain to Netlify's load balancer, OR
   - Use Netlify DNS (recommended — they handle SSL automatically)
5. Netlify will auto-provision an SSL certificate

---

## File Structure

```
├── index.html          # Complete site (HTML, CSS, JS inline)
├── netlify.toml        # Netlify build config and security headers
├── _redirects          # SPA redirect rule
├── assets/
│   └── logo/           # Place logo files here
└── README.md
```

## License

© 2025 Camelback Home Group. All rights reserved.
