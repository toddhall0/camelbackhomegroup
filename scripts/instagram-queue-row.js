#!/usr/bin/env node
// Build the Instagram permission-queue row (including the permission email) for a website listing post.
//
// Usage:
//   node scripts/instagram-queue-row.js <slug> --agent-name "Name" --agent-office "Brokerage" \
//     [--agent-email x@y.com] [--agent-phone "(480) 555-1234"] [--out row.json]
//
// The Instagram date is 5 days after the website post date. Writes the row as JSON to --out
// (or stdout). The daily routine stores it in the Instagram Permission Queue artifact.

const fs = require('fs');
const path = require('path');

const SITE = 'https://camelbackhomegroup.netlify.app';
const DELAY_DAYS = 5;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else if (!out.slug) out.slug = a;
  }
  return out;
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function longDate(ymd) {
  return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

const args = parseArgs(process.argv.slice(2));
if (!args.slug) { console.error('missing slug'); process.exit(1); }
const src = fs.readFileSync(path.join(__dirname, '..', 'listing-posts-data.js'), 'utf8');
const post = new Function(src + '\nreturn LISTING_POSTS;')().find((p) => p.slug === args.slug);
if (!post) { console.error(`no website post with slug ${args.slug}`); process.exit(1); }

const agentName = args['agent-name'] || '';
const agentOffice = args['agent-office'] || post.listingOffice || '';
const firstName = agentName.split(' ')[0] || 'there';
const pageUrl = `${SITE}/homes/${post.slug}`;
const instagramDate = addDays(post.date, DELAY_DAYS);
const fullAddress = `${post.address}, ${post.city}, ${post.state} ${post.zip}`;

const emailSubject = `Permission to feature ${post.address} on Instagram (MLS #${post.mlsNumber})`;
const emailBody = [
  `Hi ${firstName},`,
  '',
  `I'm with Camelback Home Group. We featured your listing at ${fullAddress} (MLS #${post.mlsNumber}) in a listing spotlight on our website, and we'd like to share it on our Instagram account as well:`,
  pageUrl,
  '',
  "Under ARMLS Rules 10.11 and 8.23(g), we're asking for your consent before we do. Specifically, we'd like permission to:",
  '',
  '1. Advertise the listing in an Instagram post (address, price, beds/baths and a short description), and',
  '2. Use up to five of the listing photos in that post, unaltered (no text or logos added to the photos).',
  '',
  `The post would credit you and ${agentOffice || 'your brokerage'} as the listing agent and brokerage, and direct people to the property page on our website, which shows the required ARMLS disclosures. We would post it no earlier than ${longDate(instagramDate)}. We'll take it down promptly if the listing goes under contract, if the seller objects, or whenever you ask.`,
  '',
  "If that works for you, a quick reply saying so is all we need. If you'd rather we not post it, or want any changes, just let me know.",
  '',
  'Thank you, and good luck with the listing.',
  '',
  'Camelback Home Group',
  '(480) 203-3039',
].join('\n');

const row = {
  slug: post.slug,
  address: post.address,
  city: post.city,
  price: post.price,
  beds: post.beds,
  baths: post.baths,
  sqft: post.sqft,
  mlsNumber: post.mlsNumber,
  propertyId: post.propertyId,
  image: post.image,
  pageUrl,
  websiteDate: post.date,
  instagramDate,
  agentName,
  agentOffice,
  agentEmail: args['agent-email'] || null,
  agentPhone: args['agent-phone'] || null,
  emailSubject,
  emailBody,
  emailSentAt: null,
  permission: 'pending',
  decidedAt: null,
  igStatus: 'queued',
  igPermalink: null,
  igPostedAt: null,
  igError: null,
};

const json = JSON.stringify(row, null, 2);
if (args.out) fs.writeFileSync(args.out, json);
else console.log(json);
