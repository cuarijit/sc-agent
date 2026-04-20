# Customer

## Purpose
The Customer module is a stage for **per-engagement** narrative content — the stories your team tells the customer about value delivered. Two pages — **Highlights** and **Key Takeaways** — each render a single uploaded markdown document.

## When to use it
- Quarterly business review prep: open Highlights to walk the customer through wins.
- End-of-engagement readout: Key Takeaways for the durable lessons + recommendations.
- Anytime an exec wants a one-page customer-facing summary.

## How content is authored
Admins upload `.md` files via **Administration → Documentation Management**. The two manifest entries to upload against are:
- `customer-highlights` → renders on `/customer/highlights`
- `customer-key-takeaways` → renders on `/customer/key-takeaways`

Once uploaded, the page picks up the new content immediately on next load (no restart).

## Permissions
Read access for all logged-in users. Authoring requires the **admin** role.

## Common pitfalls
- Empty page = no `.md` has been uploaded yet. The page shows a "No content uploaded" CTA pointing the admin to Documentation Management.
