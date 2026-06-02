import { App } from "@modelcontextprotocol/ext-apps";

const root = document.getElementById('root')!;

function formatDate(isoStr: string) {
  if (!isoStr) return 'N/A';
  const d = new Date(isoStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function render(data: any) {
  if (!data) { root.innerHTML = '<div class="loading">No data.</div>'; return; }
  if (data.error) { root.innerHTML = '<div class="loading">Warning: ' + data.error + '</div>'; return; }
  root.innerHTML =
    '<div class="card">' +
      '<div class="card-header">' +
        '<div class="icon">&#x2714;</div>' +
        '<h2>Booking Confirmed!</h2>' +
        '<div class="booking-id">' + data.booking_id + '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="status-badge">' + data.status + '</span></span></div>' +
        '<div class="detail-row"><span class="detail-label">Unicorn</span><span class="detail-value">' + data.unicorn_name + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Booked At</span><span class="detail-value">' + formatDate(data.booked_at) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Hourly Rate</span><span class="detail-value">$' + Number(data.hourly_rate).toFixed(2) + '/hr</span></div>' +
        '<div class="rate-info"><div class="rate-amount">$' + Number(data.hourly_rate).toFixed(2) + '/hr</div><div class="rate-label">Charged until returned</div></div>' +
      '</div>' +
    '</div>';
}

// MCP Apps lifecycle
const app = new App({ name: "booking-confirmation", version: "1.0.0" });

app.ontoolresult = (result) => {
  if (result.structuredContent) {
    render(result.structuredContent);
  }
};

app.ontoolinput = () => {};
app.onteardown = async () => ({ state: {} });

app.connect();
