// Real PDF of a proposal for the customer to download. Same data as the page (PROP.view): no cost, no team notes.
const PDFDocument = require('pdfkit');
const fm = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '-');

function build(v) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, bufferPages: !!v.preview, info: { Title: v.label + ' ' + v.number, Author: 'Maxzz Diesel' } }), chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const L = 48, R = doc.page.width - 48, W = R - L;
    doc.rect(0, 0, doc.page.width, 78).fill('#1d2126');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('MAXZZ DIESEL', L, 28);
    doc.fillColor('#fc771d').fontSize(10).text(v.label.toUpperCase(), L, 24, { width: W, align: 'right' });
    doc.fillColor('#ffffff').font('Helvetica').fontSize(14).text(v.number, L, 40, { width: W, align: 'right' });
    doc.fillColor('#5a6069').fontSize(9).font('Helvetica');
    let y = 98;
    [['Prepared for', [v.customer, v.contact].filter(Boolean).join(' · ') || '-'], ['Date', day(v.sentAt || (v.preview ? Date.now() : null))], ['Valid until', day(v.validUntil)], ['Status', v.preview ? 'Pending, not sent yet' : v.status === 'accepted' ? 'Accepted' : v.status === 'expired' ? 'Expired' : 'Waiting for acceptance']].forEach((m, i) => {
      const x = L + i * (W / 4); doc.fillColor('#8a9097').fontSize(8).text(m[0].toUpperCase(), x, y, { width: W / 4 - 8 }); doc.fillColor('#1d2126').fontSize(10).text(m[1], x, y + 12, { width: W / 4 - 8 });
    });
    y = 152;
    const cols = [L, L + 120, L + 340, L + 400, L + 470], head = () => { doc.fillColor('#8a9097').fontSize(8).font('Helvetica-Bold'); ['PART NUMBER', 'DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'].forEach((h, i) => doc.text(h, cols[i], y, { width: i < 2 ? 200 : 62, align: i < 2 ? 'left' : 'right' })); y += 14; doc.moveTo(L, y).lineTo(R, y).strokeColor('#e3e6e9').stroke(); y += 6; };
    head();
    v.lines.forEach((l) => {
      const h = Math.max(doc.heightOfString(l.name || '', { width: 210, fontSize: 9 }), 12);
      if (y + h > doc.page.height - 110) { doc.addPage(); y = 48; head(); }
      doc.font('Courier').fontSize(9).fillColor('#1d2126').text(l.code, cols[0], y, { width: 116 });
      doc.font('Helvetica').fontSize(9).fillColor('#3a4048').text(l.name || '', cols[1], y, { width: 210 });
      doc.fillColor('#1d2126').text(String(l.qty), cols[2], y, { width: 62, align: 'right' }).text(fm(l.price), cols[3], y, { width: 62, align: 'right' }).text(fm(l.amount), cols[4] - 4, y, { width: 66, align: 'right' });
      y += h + 8;
    });
    if (y > doc.page.height - 130) { doc.addPage(); y = 48; }
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#e3e6e9').stroke(); y += 10;
    const row = (label, val, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor('#1d2126').text(label, L + 300, y, { width: 100, align: 'right' }).text(val, L + 404, y, { width: 62, align: 'right' }); y += bold ? 20 : 15; };
    if (v.discount) row('Subtotal', fm(v.subtotal)), row('Discount (' + v.discountPct + '%)', '-' + fm(v.discount));
    if (v.freight) row('Freight', fm(v.freight));
    row('Total (USD)', fm(v.total), true);
    if (v.notes) { y += 8; doc.font('Helvetica').fontSize(9.5).fillColor('#1d2126').text(v.notes, L, y, { width: W }); y = doc.y; }
    y += 12; doc.font('Helvetica').fontSize(8).fillColor('#8a9097').text('Prices in USD. Taxes, if any, are added at invoicing. Stock is confirmed when we process your order. Questions: sales@maxzzdiesel.com', L, y, { width: W });
    if (v.preview) { const r = doc.bufferedPageRange(); for (let i = r.start; i < r.start + r.count; i++) { doc.switchToPage(i); doc.save(); doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] }); doc.fillColor('#d32a37').fillOpacity(0.09).font('Helvetica-Bold').fontSize(110).text('PENDING', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false }); doc.restore(); } }
    doc.end();
  });
}
module.exports = { build };
