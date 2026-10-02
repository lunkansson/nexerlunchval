import * as store from "./lunch-store.js";

const el = {
  countLabel: document.getElementById("count-label"),
  statusLabel: document.getElementById("status-label"),
  errorCard: document.getElementById("error-card"),
  errorText: document.getElementById("error-text"),
  ordersSection: document.getElementById("orders-section"),
  emptyCard: document.getElementById("empty-card"),
  tallyGrid: document.getElementById("tally-grid"),
  ordersTbody: document.getElementById("orders-tbody"),
  allergyCard: document.getElementById("allergy-card"),
  allergyList: document.getElementById("allergy-list"),
  copyBtn: document.getElementById("copy-btn"),
  mailLink: document.getElementById("mail-link"),
  clearBtn: document.getElementById("clear-btn"),
};

let state = { orders: [], locked: false, deadlineLabel: "", weekLabel: "fredag" };
let copyLabel = "Kopiera sammanställning";

function summaryText() {
  const counts = {};
  state.orders.forEach((o) => { counts[o.dish] = (counts[o.dish] || 0) + 1; });
  const lines = ["Lunchbeställning Bistrot – " + state.weekLabel, ""];
  Object.keys(counts).forEach((k) => lines.push(counts[k] + "x " + k));
  lines.push("", "Deltagare:");
  state.orders.forEach((o) => {
    lines.push("- " + o.name + ": " + o.dish + (o.allergies ? " – allergi: " + o.allergies : ""));
  });
  lines.push("", "Totalt: " + state.orders.length + " portioner");
  return lines.join("\n");
}

async function removeOrder(o) {
  if (!window.confirm("Ta bort " + o.name + "s beställning (" + o.dish + ")?")) return;
  try {
    await store.remove(o.id);
    load();
  } catch (e) {
    setError(e.message);
  }
}

async function togglePickedUp(o, nameSpan, checkbox) {
  const next = checkbox.checked;
  nameSpan.classList.toggle("picked-up", next);
  try {
    await store.setPickedUp(o.id, next);
    o.picked_up = next;
  } catch (e) {
    checkbox.checked = !next;
    nameSpan.classList.toggle("picked-up", !next);
    setError(e.message);
  }
}

async function clearAll() {
  if (!window.confirm("Rensa hela listan – " + state.orders.length + " beställningar tas bort. Är du säker?")) return;
  try {
    await store.clear();
    load();
  } catch (e) {
    setError(e.message);
  }
}

function setError(message) {
  el.errorText.textContent = message || "";
  el.errorCard.hidden = !message;
}

function renderTally(counts) {
  el.tallyGrid.replaceChildren();
  for (const dish of Object.keys(counts)) {
    const card = document.createElement("div");
    card.className = "card elev-sm tally-card";

    const kicker = document.createElement("div");
    kicker.className = "card-kicker";
    kicker.textContent = dish;

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = String(counts[dish]);

    card.appendChild(kicker);
    card.appendChild(title);
    el.tallyGrid.appendChild(card);
  }
}

function renderTable() {
  el.ordersTbody.replaceChildren();
  for (const o of state.orders) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.style.fontWeight = "500";

    const nameLabel = document.createElement("label");
    nameLabel.style.display = "inline-flex";
    nameLabel.style.alignItems = "center";
    nameLabel.style.gap = "9px";
    nameLabel.style.cursor = "pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.accentColor = "var(--color-accent)";
    checkbox.checked = !!o.picked_up;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = o.name;
    if (o.picked_up) nameSpan.classList.add("picked-up");

    checkbox.addEventListener("change", () => togglePickedUp(o, nameSpan, checkbox));

    nameLabel.appendChild(checkbox);
    nameLabel.appendChild(nameSpan);
    nameTd.appendChild(nameLabel);

    const dishTd = document.createElement("td");
    dishTd.textContent = o.dish;

    const allergyTd = document.createElement("td");
    if (o.allergies) {
      const tag = document.createElement("span");
      tag.className = "tag tag-accent";
      tag.textContent = o.allergies;
      allergyTd.appendChild(tag);
    } else {
      const dash = document.createElement("span");
      dash.style.color = "color-mix(in srgb, var(--color-text) 40%, transparent)";
      dash.textContent = "–";
      allergyTd.appendChild(dash);
    }

    const actionTd = document.createElement("td");
    actionTd.style.textAlign = "right";
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost";
    removeBtn.type = "button";
    removeBtn.style.fontSize = "12px";
    removeBtn.textContent = "Ta bort";
    removeBtn.addEventListener("click", () => removeOrder(o));
    actionTd.appendChild(removeBtn);

    tr.appendChild(nameTd);
    tr.appendChild(dishTd);
    tr.appendChild(allergyTd);
    tr.appendChild(actionTd);
    el.ordersTbody.appendChild(tr);
  }
}

function renderAllergyList(withAllergies) {
  el.allergyList.replaceChildren();
  el.allergyCard.hidden = withAllergies.length === 0;
  for (const a of withAllergies) {
    const row = document.createElement("div");
    row.style.fontSize = "14px";
    row.textContent = a.name + " · " + a.allergies;
    el.allergyList.appendChild(row);
  }
}

function render() {
  const orders = state.orders;
  const counts = {};
  orders.forEach((o) => { counts[o.dish] = (counts[o.dish] || 0) + 1; });
  const withAllergies = orders.filter((o) => o.allergies);
  const text = summaryText();

  el.countLabel.textContent = orders.length === 1 ? "1 portion" : orders.length + " portioner";
  el.statusLabel.textContent = state.locked
    ? "anmälan stängd"
    : "öppen till " + (state.deadlineLabel || "Torsdag kl 13:00");

  el.ordersSection.hidden = orders.length === 0;
  el.emptyCard.hidden = orders.length > 0;

  renderTally(counts);
  renderTable();
  renderAllergyList(withAllergies);

  el.copyBtn.textContent = copyLabel;
  el.mailLink.href = "mailto:catering@bistrot.se?subject=" +
    encodeURIComponent("Lunchbeställning " + state.weekLabel) +
    "&body=" + encodeURIComponent(text);
}

el.copyBtn.addEventListener("click", () => {
  const text = summaryText();
  const done = () => { copyLabel = "Kopierad ✓"; render(); };
  try {
    navigator.clipboard.writeText(text).then(done, done);
  } catch (e) {
    done();
  }
});

el.clearBtn.addEventListener("click", clearAll);

async function load() {
  try {
    const orders = await store.list();
    state = { ...state, orders, locked: store.isLocked() };
    setError("");
    render();
  } catch (e) {
    setError(e.message);
  }
}

state = { ...state, locked: store.isLocked(), deadlineLabel: store.deadlineLabel(), weekLabel: store.weekLabel() };
load();
setInterval(load, 15000);
window.addEventListener("focus", load);
