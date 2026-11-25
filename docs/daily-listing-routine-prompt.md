# Daily listing routine: prompt

Paste everything below the line into the scheduled routine's prompt (claude.ai/code → Routines → edit).

Before Instagram posting can work, add two environment variables to the routine's cloud environment:
`IG_USER_ID` (your Instagram professional account ID) and `IG_ACCESS_TOKEN` (a long-lived token with
`instagram_content_publish`). Until then, part B reports "Instagram not connected" instead of posting.

---

Generate TWO new listing spotlight posts for the Camelback Home Group website, queue them for Instagram permission, and post to Instagram any earlier homes whose listing agents have given permission. Do this all directly. Do NOT call the generate-listing-post Netlify function (it times out).

Instagram Permission Queue (the approvals page): https://claude.ai/artifact/RR2ALyJTwrzSkipoW6TrRJ
Read and write its database with the ArtifactData tool, collection "homes", one document per home, doc_id = the post slug.

## Part A: website posts

For EACH of the two posts:

1. FETCH A LISTING: Pick TWO different cities by rotating through: Scottsdale, Mesa, Chandler, Gilbert, Tempe, Glendale, Peoria, Surprise, Goodyear, Buckeye, Queen Creek, Maricopa, Fountain Hills, Phoenix, Cave Creek. For the first post use (day of year * 2) mod 15, for the second use (day of year * 2 + 1) mod 15. Call the live listings endpoint for each:
   curl -s -X POST "https://camelbackhomegroup.netlify.app/.netlify/functions/listings" -H "Content-Type: application/json" -d '{"q":"CITY_NAME","limit":10,"sort":"-listdate","minPrice":300000}'
   Pick a listing that has a photo, beds > 0. Make sure it's not already in listing-posts-data.js (check the slug).

2. GET FULL DETAILS: curl -s "https://camelbackhomegroup.netlify.app/.netlify/functions/property?id=LISTING_ID"
   Note the listing agent's name, office, email and phone (listing.agent.name / .office / .email / .phone). Email and phone may be null.

3. WRITE THE POST: 600-900 words of SEO-optimized content about this specific property. Include:
   - An engaging overview of the property
   - Features and layout based on the MLS description
   - Neighborhood/city context
   - Market context (is this a good value)
   - Natural mention of Camelback Home Group's attorney and paralegal oversight
   - Call to action to schedule a showing or contact the team at (480) 203-3039
   Use HTML: <h2> headings, <p> paragraphs, <ul>/<li> lists, <strong> emphasis.

4. BUILD THE POST OBJECT with these fields:
   slug: address-city-state-zip in lowercase with hyphens (e.g. "1234-e-main-st-scottsdale-az-85251")
   title: "Full Address, City, ST ZIP"
   address, city, state, zip, date (today), price, beds, baths, halfBaths, sqft, lotSize, yearBuilt,
   garage, pool, subdivision, propertyType, status, daysOnMarket, mlsNumber, propertyId (the SimplyRETS id),
   listingOffice, image (first photo URL), photos (up to 5 photo URLs), excerpt (2-3 sentences),
   metaDescription (one sentence), content (your HTML)

5. UPDATE THE DATA FILE: Add BOTH new posts to the BEGINNING of the LISTING_POSTS array in /home/user/camelbackhomegroup/listing-posts-data.js. Skip any whose slug already exists. Keep only the most recent 365 posts. The file mixes JSON-style and plain JavaScript objects, so insert the new entries as text right after the opening "var LISTING_POSTS = [" line rather than JSON-parsing the file.

6. VERIFY: node --check listing-posts-data.js

7. QUEUE FOR INSTAGRAM PERMISSION: For each new post, run
   node scripts/instagram-queue-row.js SLUG --agent-name "NAME" --agent-office "OFFICE" [--agent-email EMAIL] [--agent-phone PHONE] --out SCRATCHPAD/SLUG.json
   then create the document with ArtifactData "set" (collection "homes", doc_id SLUG, file_path the JSON file). Skip a slug that already has a document. The row contains the permission email and an Instagram date 5 days after the website post.

8. COMMIT AND PUSH: git add listing-posts-data.js && git commit -m "Add listing posts: [address1] + [address2]" && git push -u origin claude/camelback-landing-page-8t0Yy
   If this session has a different designated development branch, push the same commit there too. If a push is rejected, fetch and merge (do not force-push), then push again.

## Part B: Instagram

9. READ THE QUEUE: ArtifactData "list" collection "homes" (page through all documents).

10. POST APPROVED HOMES: For each document with permission == "granted", igStatus == "queued" (or "failed"), and instagramDate <= today:
    a. Re-check the listing: curl the property endpoint with the document's propertyId. If the listing no longer exists or its status is not Active, update the document (pin if_version) to igStatus "withdrawn", igError "listing no longer active (STATUS)", and do not post.
    b. Otherwise run: node scripts/instagram-post.js SLUG --listed-by "AGENT NAME, AGENT OFFICE"
       On {"ok":true}: update the document to igStatus "posted", igPermalink, igPostedAt (today), igError null.
       On {"ok":false}: update to igStatus "failed" and igError (the message). If the error says IG_USER_ID / IG_ACCESS_TOKEN are not set, record igError "Instagram not connected" and leave igStatus "queued".
    Never post a home unless permission == "granted". Never post before its instagramDate.

11. EXPIRE STALE REQUESTS: For documents with permission == "pending" whose instagramDate is more than 25 days ago, set igStatus "withdrawn", igError "no permission after 30 days".

## Part C: report to me (every day)

12. Send a PushNotification every run (this is how you ask me for permission decisions). Wrap it in <routine_summary> tags. Lead with the one sentence that matters most. Include:
    - Homes POSTED to Instagram today, with permalinks, and any posting failures.
    - "Did you get permission for these?" followed by each home with permission == "pending" whose instagramDate <= today (address, listing agent and brokerage, Instagram date). Tell me to record the answer on the Instagram Permission Queue page.
    - The two NEW website homes (address, city, price, beds/baths), noting their permission emails are ready on the queue page to send, and which agents have no email address in the data.
    - These two links, always, at the end:
      Instagram Permission Queue: https://claude.ai/artifact/RR2ALyJTwrzSkipoW6TrRJ
      All posted homes: https://camelbackhomegroup.netlify.app/listing-posts-index.html
    If any step failed (listings endpoint, push, queue access), lead with that.
