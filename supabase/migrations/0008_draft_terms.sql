-- Draft terms for the B2B portal. Status stays 'draft': nobody sees it and nobody can be invited until an admin reviews and publishes it.
insert into public.terms_versions (version, status, body) values ('v0-draft', 'draft',
$t$DRAFT, NOT REVIEWED. This text must be reviewed and approved by Maxzz Diesel before it is published.

Maxzz Diesel B2B Portal: Terms of Use

1. Who can use the portal
The portal is for wholesale customers of Maxzz Diesel Corp. ("Maxzz Diesel") that were approved or invited by us. Access is personal to the person who signs in. Do not share your sign-in link. We may suspend access at any time.

2. Prices, stock and orders
Prices shown are your customer prices and are confidential. Prices and stock can change without notice. An order placed in the portal is a purchase request that Maxzz Diesel confirms. When you order more than the quantity in stock, the line is marked as backorder and our team will contact you about the lead time. Taxes, freight and fees may be added at invoicing.

3. Payment and credit
Payment terms are the ones set on your account with Maxzz Diesel. We may hold an order if the account is on credit hold.

4. Vouchers
A voucher applies to one order, cannot be combined with another voucher and has the validity, limits and conditions shown when it was issued. We may cancel a voucher that is misused.

5. Returns and warranty
Returns and warranty follow the Maxzz Diesel return and warranty policy in effect when you ordered. Core returns follow the terms agreed with your account manager.

6. Your data and activity in the portal
We store your contact details, your company, your orders and quotes, and how you use the portal (pages and products viewed, searches, cart actions, device type and approximate location). We use this to run the portal, to serve you better and to improve our products and offers. Activity records are kept for 12 months. We do not sell your data. You can ask us to correct or delete your data by writing to the Maxzz Diesel team.

7. E-mail
We send you e-mails needed to run your account, such as sign-in links, order updates and quotes. Marketing e-mails are sent only if you agreed to them and you can opt out in each message.

8. Changes
We may update these terms. When we do, you will be asked to accept the new version.

9. Contact
Maxzz Diesel Corp., Coconut Creek, Florida.$t$)
on conflict (version) do nothing;
