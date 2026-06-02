import { App } from "@modelcontextprotocol/ext-apps";

const root = document.getElementById('root')!;

function render(data: any) {
  if (!data) { root.innerHTML = '<div class="loading">No data.</div>'; return; }
  if (data.error) { root.innerHTML = '<div class="loading">Warning: ' + data.error + '</div>'; return; }
  const u = data.unicorn;
  const avail = data.available;
  root.innerHTML =
    '<div class="card">' +
      '<div class="card-header ' + (avail ? 'available' : 'unavailable') + '">' +
        '<div class="icon">' + (avail ? '&#x2714;' : '&#x2718;') + '</div>' +
        '<h2>' + (avail ? 'Available!' : 'Not Available') + '</h2>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="detail-row"><span class="detail-label">Unicorn</span><span class="detail-value">' + u.name + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">' + u.type + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">' + data.date + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">' + data.duration_hours + ' hour' + (data.duration_hours > 1 ? 's' : '') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Rate</span><span class="detail-value">$' + Number(u.hourly_rate).toFixed(2) + '/hr</span></div>' +
        '<div class="total"><div class="total-amount">$' + Number(data.total_cost).toFixed(2) + '</div><div class="total-label">Estimated Total</div></div>' +
      '</div>' +
    '</div>';
}

// MCP Apps lifecycle
const app = new App({ name: "availability-check", version: "1.0.0" });

app.ontoolresult = (result) => {
  if (result.structuredContent) {
    render(result.structuredContent);
  }
};

app.ontoolinput = () => {};
app.onteardown = async () => ({ state: {} });

app.connect();
