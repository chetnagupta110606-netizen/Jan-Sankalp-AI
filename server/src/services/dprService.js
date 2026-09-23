const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../config');

function line(doc, label, value) {
  doc.font('Helvetica-Bold').fontSize(11).text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value || '—');
}

function generateDpr(report) {
  fs.mkdirSync(config.dprOutputDir, { recursive: true });
  const filePath = path.join(config.dprOutputDir, `${report.trackingId}.pdf`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.font('Helvetica-Bold').fontSize(18).text('Detailed Project Report (DPR)');
    doc.font('Helvetica').fontSize(11).text('Jan-Sankalp AI — auto-generated emergency infrastructure report');
    doc.moveDown();

    line(doc, 'Tracking ID', report.trackingId);
    line(doc, 'Channel', report.channel);
    line(doc, 'Reported by', report.senderPhone);
    line(doc, 'Reported at', report.createdAt);
    doc.moveDown(0.5);

    line(doc, 'Location', report.location.name);
    line(doc, 'Coordinates', `${report.location.latitude.toFixed(6)}, ${report.location.longitude.toFixed(6)}`);
    line(doc, 'H3 cell', report.location.h3Cell);
    line(doc, 'Location source', report.location.source);
    doc.moveDown(0.5);

    line(doc, 'Priority', report.emergency ? 'EMERGENCY' : 'STANDARD');
    line(doc, 'Media', report.mediaUrl);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(12).text('Reported description');
    doc.font('Helvetica').fontSize(11).text(report.description || '—');
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(12).text('Voice note transcript');
    doc.font('Helvetica').fontSize(11).text(report.transcript || 'No transcript available');
    doc.moveDown(0.5);

    line(doc, 'Track DPR audit', report.trackingUrl);

    doc.end();
  });
}

module.exports = { generateDpr };
