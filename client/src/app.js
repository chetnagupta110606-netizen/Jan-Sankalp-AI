const reportList = document.getElementById('report-list');
const reportForm = document.getElementById('report-form');
const resolutionForm = document.getElementById('resolution-form');
const resolutionSelect = document.getElementById('resolution-report');
const resolutionResult = document.getElementById('resolution-result');
const gateConfig = document.getElementById('gate-config');

const VERIFIED_STATUSES = new Set(['RESOLVED_VERIFIED', 'CLOSED', 'APPROVED']);

function isAiGroundVerified(report) {
  return (
    VERIFIED_STATUSES.has(report.status) &&
    Boolean(report.resolution && report.resolution.aiGroundVerified)
  );
}

function createBadge() {
  const badge = document.createElement('span');
  badge.className = 'badge-ai-verified';
  badge.title = 'Photo EXIF location and structural similarity checks passed';

  const check = document.createElement('span');
  check.className = 'check';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = '\u2713';

  badge.append(check, document.createTextNode('AI Ground Verified'));
  return badge;
}

function auditSummary(report) {
  const resolution = report.resolution;
  if (!resolution) {
    return 'Awaiting proof of resolution.';
  }

  const parts = [];
  if (resolution.location && resolution.location.distanceMeters !== null) {
    parts.push(`${resolution.location.distanceMeters}m from target cell`);
  }
  if (resolution.similarity && resolution.similarity.confidencePercent != null) {
    parts.push(`${resolution.similarity.confidencePercent}% similarity`);
  }
  if (resolution.flaggedForDistrictCollectorReview) {
    parts.push('flagged for District Collector Review');
  }
  if (resolution.reason) {
    parts.push(resolution.reason);
  }
  return parts.join(' \u2022 ');
}

function renderReport(report) {
  const item = document.createElement('li');
  item.className = 'report-card';

  const header = document.createElement('header');

  const title = document.createElement('h3');
  title.textContent = report.title;

  const status = document.createElement('span');
  status.className = `status status-${report.status.toLowerCase()}`;
  status.textContent = report.status.replaceAll('_', ' ');

  header.append(title, status);

  if (isAiGroundVerified(report)) {
    header.append(createBadge());
  }

  const detail = document.createElement('p');
  detail.className = 'audit-detail';
  detail.textContent = auditSummary(report);

  item.append(header, detail);
  return item;
}

function renderReports(reports) {
  reportList.replaceChildren(...reports.map(renderReport));
  resolutionSelect.replaceChildren(
    ...reports.map((report) => {
      const option = document.createElement('option');
      option.value = report.id;
      option.textContent = `${report.title} (${report.status})`;
      return option;
    }),
  );
}

async function loadReports() {
  const response = await fetch('/api/reports');
  renderReports(await response.json());
}

async function loadConfig() {
  const response = await fetch('/api/config');
  const config = await response.json();
  gateConfig.textContent = `Target cell ${config.targetH3Cell} \u2022 max ${config.maxDistanceMeters}m \u2022 similarity \u2265 ${Math.round(config.similarityThreshold * 100)}%`;
  document.getElementById('report-h3').value = config.targetH3Cell;
}

reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await fetch('/api/reports', {
    method: 'POST',
    body: new FormData(reportForm),
  });
  reportForm.reset();
  await Promise.all([loadConfig(), loadReports()]);
});

resolutionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(resolutionForm);
  const reportId = formData.get('reportId');
  formData.delete('reportId');

  resolutionResult.textContent = 'Running AI gate\u2026';
  const response = await fetch(`/api/reports/${reportId}/resolution`, {
    method: 'POST',
    body: formData,
  });
  const report = await response.json();
  resolutionResult.textContent = report.resolution
    ? `${report.resolution.status}${report.resolution.reason ? ` \u2014 ${report.resolution.reason}` : ''}`
    : report.error || 'Unexpected response';

  resolutionForm.reset();
  await loadReports();
});

loadConfig();
loadReports();
