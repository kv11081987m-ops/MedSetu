// R4-B: client-side bill/invoice PDF generation (jsPDF + jspdf-autotable).
// Expects the RAW order row shape returned by fetchOrderById/fetchOrders
// (order.sellers embed with store_name/address/phone/district/owner_name/
// drug_license/gst_number/invoice_prefix, order.order_items[] with
// name/quantity/unit_price/total_price) — see orders.js.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatIST } from './formatTime';
import { supabase } from './supabase';

const COLORS = {
  orange: [242, 108, 10],  // #F26C0A
  blue: [12, 68, 124],     // #0C447C
  gold: [224, 168, 24],    // #E0A818
  green: [26, 107, 60],    // #1A6B3C
  gray: [90, 90, 90],
  lightGray: [225, 225, 225],
};

const money = (v) => `Rs. ${parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

async function loadLogoDataUrl() {
  try {
    const res = await fetch('/logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Old delivered orders may predate R4-A's seller-accept wiring (033) and
// have no invoice_number yet — generate one on demand (idempotent RPC,
// customer is allowed to call it for their own order, 032). If that also
// fails for any reason, fall back to order_number so the bill still has
// a unique, printable reference.
async function resolveInvoiceNumber(order) {
  if (order.invoice_number) return { number: order.invoice_number, isFallback: false };
  try {
    const { data, error } = await supabase.rpc('generate_invoice_number', { p_order_id: order.id });
    if (!error && data?.success && data.invoice_number) {
      return { number: data.invoice_number, isFallback: false };
    }
  } catch (e) {
    console.warn('[invoice pdf] generate_invoice_number failed', e);
  }
  return { number: order.order_number || order.id, isFallback: true };
}

export async function generateInvoicePDF(order) {
  const seller = order.sellers || {};
  const items = order.order_items || [];
  const { number: invoiceNo, isFallback } = await resolveInvoiceNumber(order);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 40;

  // ── Header ──
  const logoDataUrl = await loadLogoDataUrl();
  const textX = margin + (logoDataUrl ? 48 : 0);
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', margin, y, 40, 40); } catch { /* graceful skip */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.orange);
  doc.text('MedSetu', textX, y + 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.blue);
  doc.text('Apki Dawai Apke Dwaar · SetuSphere', textX, y + 34);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.blue);
  doc.text('TAX INVOICE', pageWidth - margin, y + 10, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.gray);
  const dateStr = formatIST(order.created_at, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  [
    `Invoice No: ${invoiceNo}${isFallback ? ' (order ref)' : ''}`,
    `Order No: ${order.order_number || '-'}`,
    `Date: ${dateStr}`,
  ].forEach((line, i) => doc.text(line, pageWidth - margin, y + 26 + i * 12, { align: 'right' }));

  y += 60;
  doc.setDrawColor(...COLORS.gold);
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  // ── Sold By (seller legal block) ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.blue);
  doc.text('SOLD BY', margin, y);
  const soldByTop = y + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  const soldByLines = [
    seller.store_name || 'Seller',
    [seller.address, seller.district].filter(Boolean).join(', ') || null,
    seller.phone ? `Phone: ${seller.phone}` : null,
    seller.drug_license ? `Drug License No: ${seller.drug_license}` : null,
    seller.gst_number ? `GSTIN: ${seller.gst_number}` : null,
    seller.owner_name ? `Prop: ${seller.owner_name}` : null,
  ].filter(Boolean);
  soldByLines.forEach((line, i) => doc.text(line, margin, soldByTop + i * 13, { maxWidth: pageWidth / 2 - margin - 10 }));

  // ── Bill To (customer block, same row) ──
  const billToX = pageWidth / 2 + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.blue);
  doc.text('BILL TO', billToX, y);
  const billToTop = y + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  const billToLines = [
    order.customer_name || 'Customer',
    order.delivery_address || null,
    order.delivery_pincode ? `Pincode: ${order.delivery_pincode}` : null,
    order.customer_phone ? `Phone: ${order.customer_phone}` : null,
  ].filter(Boolean);
  billToLines.forEach((line, i) => doc.text(line, billToX, billToTop + i * 13, { maxWidth: pageWidth - margin - billToX }));

  y = Math.max(soldByTop + soldByLines.length * 13, billToTop + billToLines.length * 13) + 20;

  // ── Items table ──
  const rows = items.map((it, i) => [
    String(i + 1),
    it.name || 'Item',
    String(it.quantity ?? '-'),
    money(it.unit_price),
    money(it.total_price),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['#', 'Medicine', 'Qty', 'MRP (Rs.)', 'Amount (Rs.)']],
    body: rows.length ? rows : [['-', 'No items', '-', '-', '-']],
    theme: 'grid',
    headStyles: { fillColor: COLORS.blue, textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 6 },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      2: { cellWidth: 40, halign: 'center' },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 90 },
    },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 20;

  // ── Totals ──
  const totalsX = pageWidth - margin - 180;
  const totalLine = (label, value, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.bold ? 11 : 9.5);
    doc.setTextColor(...(opts.bold ? COLORS.green : [60, 60, 60]));
    doc.text(label, totalsX, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += opts.bold ? 18 : 14;
  };
  totalLine('Subtotal', money(order.total_amount));
  totalLine('Delivery Charge', money(order.delivery_charge));
  doc.setDrawColor(...COLORS.lightGray);
  doc.line(totalsX, y, pageWidth - margin, y);
  y += 10;
  totalLine('Grand Total', money(order.final_amount), { bold: true });

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(60, 60, 60);
  doc.text(
    `Payment Mode: ${order.payment_method === 'cod' ? 'Cash on Delivery' : (order.payment_method || '-')}`,
    margin, y
  );
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.green);
  doc.text('Status: Delivered', margin, y);

  // ── Footer ──
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 50;
  doc.setDrawColor(...COLORS.lightGray);
  doc.line(margin, footerY - 14, pageWidth - margin, footerY - 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.orange);
  doc.text('Fulfilled by MedSetu · Powered by SetuSphere', pageWidth / 2, footerY, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 140);
  doc.text(
    'Computer-generated invoice, signature ki zaroorat nahi. Registered pharmacist ki nigrani.',
    pageWidth / 2, footerY + 12, { align: 'center' }
  );

  doc.save(`${invoiceNo.replace(/\//g, '-')}.pdf`);
  return { invoiceNumber: invoiceNo, isFallback };
}
