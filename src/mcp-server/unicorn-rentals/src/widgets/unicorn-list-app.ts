import { App } from "@modelcontextprotocol/ext-apps";

const root = document.getElementById('root')!;

function badgeClass(type: string) {
  return 'badge badge-' + type.toLowerCase();
}

function render(data: any) {
  if (!data || !data.unicorns) {
    root.innerHTML = '<div class="loading">No data available.</div>';
    return;
  }
  const unicorns = data.unicorns;
  root.innerHTML =
    '<div class="header"><h1>AnyCompany Unicorn Rentals</h1><p>' +
    data.total + ' unicorn' + (data.total !== 1 ? 's' : '') + ' available</p></div>' +
    '<div class="grid">' + unicorns.map(function(u: any) {
      return '<div class="card">' +
        '<div class="card-img">' +
        (u.image_url ? '<img src="' + u.image_url + '" alt="' + u.name + '">' : '<span class="placeholder">&#129412;</span>') +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-title">' + u.name + '</div>' +
          '<span class="' + badgeClass(u.type) + '">' + u.type + '</span>' +
          '<p class="desc">' + u.description + '</p>' +
          '<div class="price">$' + Number(u.hourly_rate).toFixed(2) + ' <span>/hour</span></div>' +
          '<div class="status ' + (u.available ? 'available' : 'unavailable') + '">' +
          (u.available ? 'Available' : 'Currently Unavailable') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
}

// MCP Apps lifecycle
const app = new App({ name: "unicorn-list", version: "1.0.0" });

app.ontoolresult = (result) => {
  if (result.structuredContent) {
    render(result.structuredContent);
  }
};

app.ontoolinput = () => {};
app.onteardown = async () => ({ state: {} });

app.connect();
