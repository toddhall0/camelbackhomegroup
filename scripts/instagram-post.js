#!/usr/bin/env node
// Publish a website listing post to Instagram as a photo carousel.
//
// Usage:
//   node scripts/instagram-post.js <slug> --listed-by "Agent Name, Brokerage" [--dry-run]
//
// Requires env vars (not needed with --dry-run):
//   IG_USER_ID       Instagram professional account ID (from the Meta Graph API)
//   IG_ACCESS_TOKEN  Long-lived access token with instagram_content_publish permission
//
// Only run this for a listing whose listing agent has given written permission
// (ARMLS Rules 10.11 and 8.23(g)). Photos are posted unaltered, per Rule 8.23(e).
// Prints one JSON line: {"ok":true,"mediaId":"...","permalink":"..."} or {"ok":false,"error":"..."}.

const fs = require('fs');
const path = require('path');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SITE = 'https://camelbackhomegroup.netlify.app';
const MAX_PHOTOS = 5;

function fail(error) {
  console.log(JSON.stringify({ ok: false, error }));
  process.exit(1);
}

function parseArgs(argv) {
  const out = { slug: null, listedBy: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--listed-by') out.listedBy = argv[++i];
    else if (!out.slug) out.slug = a;
  }
  return out;
}

function loadPost(slug) {
  const file = path.join(__dirname, '..', 'listing-posts-data.js');
  const src = fs.readFileSync(file, 'utf8');
  const posts = new Function(src + '\nreturn LISTING_POSTS;')();
  return posts.find((p) => p.slug === slug);
}

function hashtag(s) {
  return '#' + String(s).replace(/[^A-Za-z0-9]/g, '');
}

function buildCaption(post, listedBy) {
  const price = '$' + Number(post.price).toLocaleString('en-US');
  const facts = [
    post.beds ? `${post.beds} bd` : null,
    post.baths ? `${post.baths}${post.halfBaths ? '.5' : ''} ba` : null,
    post.sqft ? `${Number(post.sqft).toLocaleString('en-US')} sq ft` : null,
    price,
  ].filter(Boolean).join(' | ');
  const tags = [
    hashtag(post.city + 'AZ'), hashtag(post.city + 'RealEstate'), hashtag(post.city + 'Homes'),
    '#ArizonaRealEstate', '#PhoenixRealEstate', '#AZHomes', '#HomeForSale', '#HouseHunting',
    '#CamelbackHomeGroup',
  ];
  return [
    `Featured home in ${post.city}: ${post.address}`,
    facts,
    '',
    post.excerpt,
    '',
    `Full details, photos and neighborhood info: link in bio, or visit ${SITE}/homes/${post.slug}`,
    '',
    `Listing courtesy of ${listedBy}. Shared with the listing agent's permission.`,
    '',
    'Presented by Camelback Home Group, a licensed real estate brokerage with attorney and paralegal oversight on every transaction. Call (480) 203-3039 to schedule a showing.',
    '',
    'Source: ARMLS. All information should be verified by the recipient and none is guaranteed as accurate by ARMLS.',
    '',
    tags.join(' '),
  ].join('\n');
}

async function graph(method, endpoint, params) {
  const url = new URL(GRAPH + endpoint);
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  let res;
  if (method === 'GET') {
    body.forEach((v, k) => url.searchParams.set(k, v));
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body });
  }
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`${endpoint}: ${data.error ? data.error.message : res.status}`);
  }
  return data;
}

async function waitFinished(containerId) {
  for (let i = 0; i < 30; i++) {
    const s = await graph('GET', `/${containerId}`, { fields: 'status_code' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`container ${containerId} status ${s.status_code}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`container ${containerId} did not finish processing`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) fail('missing slug');
  const post = loadPost(args.slug);
  if (!post) fail(`no website post with slug ${args.slug}`);
  const listedBy = args.listedBy || post.listingOffice;
  if (!listedBy) fail('missing --listed-by (listing agent and brokerage)');

  const photos = (post.photos && post.photos.length ? post.photos : [post.image])
    .filter((u) => typeof u === 'string' && u.startsWith('https://'))
    .slice(0, MAX_PHOTOS);
  if (!photos.length) fail('post has no photos');
  const caption = buildCaption(post, listedBy);

  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, photos, caption }, null, 2));
    return;
  }
  const igUser = process.env.IG_USER_ID;
  if (!igUser || !process.env.IG_ACCESS_TOKEN) fail('IG_USER_ID and IG_ACCESS_TOKEN must be set');

  let creationId;
  if (photos.length === 1) {
    const c = await graph('POST', `/${igUser}/media`, { image_url: photos[0], caption });
    creationId = c.id;
  } else {
    const children = [];
    for (const image_url of photos) {
      const c = await graph('POST', `/${igUser}/media`, { image_url, is_carousel_item: 'true' });
      children.push(c.id);
    }
    for (const id of children) await waitFinished(id);
    const carousel = await graph('POST', `/${igUser}/media`, {
      media_type: 'CAROUSEL', children: children.join(','), caption,
    });
    creationId = carousel.id;
  }
  await waitFinished(creationId);
  const published = await graph('POST', `/${igUser}/media_publish`, { creation_id: creationId });
  const info = await graph('GET', `/${published.id}`, { fields: 'permalink' });
  console.log(JSON.stringify({ ok: true, mediaId: published.id, permalink: info.permalink }));
}

main().catch((e) => fail(e.message));
