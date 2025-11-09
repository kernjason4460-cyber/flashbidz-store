# FlashBidz Store — Final (Venmo @FlashBidz, Cash App $FlashBidz, Auto MI Tax)

This build auto-adds Michigan 6% sales tax and routes buyers to your real Venmo/Cash App with tax-included totals.

## Deploy
1) Unzip the folder.
2) In Netlify → Add new site → Deploy manually → drag the unzipped folder.
3) Optional: map `store.flashbidz.net` in Namecheap (CNAME → your Netlify subdomain), then enable HTTPS in Netlify.

## Update items
- Edit `products.json` (pre-tax prices). Add your photos under `/img` and update image paths.
- The page shows Subtotal + Tax + Total and fills that Total in Venmo/Cash App links.

You're all set!
