import * as store from "./lunch-store.js";

const el = {
  meetingDate: document.getElementById("meeting-date"),
  deadlineLabel: document.getElementById("deadline-label"),
  lockedBanner: document.getElementById("locked-banner"),
  lockedDeadline: document.getElementById("locked-deadline"),
  menuGroups: document.getElementById("menu-groups"),
  form: document.getElementById("lv-form"),
  nameInput: document.getElementById("lv-name"),
  allergyInput: document.getElementById("lv-allergy"),
  submit: document.getElementById("lv-submit"),
  notice: document.getElementById("lv-notice"),
  countLabel: document.getElementById("count-label"),
  tallyList: document.getElementById("tally-list"),
  emptyNote: document.getElementById("empty-note"),
  errorNote: document.getElementById("error-note"),
};

function renderMenu(groups) {
  el.menuGroups.replaceChildren();
  for (const g of groups || []) {
    const groupEl = document.createElement("div");
    groupEl.className = "menu-group";

    const title = document.createElement("h6");
    title.textContent = g.title;
    groupEl.appendChild(title);

    for (const d of g.items || []) {
      const label = document.createElement("label");
      label.className = "radio dish";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "dish";
      input.value = d.name;

      const dot = document.createElement("span");
      dot.className = "dot";

      const main = document.createElement("span");
      main.className = "dish-main";

      const nameRow = document.createElement("span");
      nameRow.className = "dish-name-row";

      const name = document.createElement("strong");
      name.className = "dish-name";
      name.textContent = d.name;
      nameRow.appendChild(name);

      for (const t of d.tags || []) {
        const tag = document.createElement("span");
        tag.className = "tag tag-outline";
        tag.textContent = t;
        nameRow.appendChild(tag);
      }

      const desc = document.createElement("span");
      desc.className = "dish-desc";
      desc.textContent = d.desc || "";

      main.appendChild(nameRow);
      main.appendChild(desc);

      label.appendChild(input);
      label.appendChild(dot);
      label.appendChild(main);
      groupEl.appendChild(label);
    }

    el.menuGroups.appendChild(groupEl);
  }
}

function renderTally(orders) {
  const counts = {};
  for (const o of orders) counts[o.dish] = (counts[o.dish] || 0) + 1;

  el.tallyList.replaceChildren();
  for (const dish of Object.keys(counts)) {
    const row = document.createElement("div");
    row.className = "tally-row";

    const label = document.createElement("span");
    label.className = "dish-label";
    label.textContent = dish;

    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(counts[dish]);

    row.appendChild(label);
    row.appendChild(n);
    el.tallyList.appendChild(row);
  }

  el.tallyList.hidden = orders.length === 0;
  el.emptyNote.hidden = orders.length > 0;
  el.countLabel.textContent = orders.length === 1 ? "1 portion" : orders.length + " portioner";
}

function setError(message) {
  el.errorNote.textContent = message || "";
  el.errorNote.hidden = !message;
}

function setNotice(message) {
  el.notice.textContent = message || "";
}

function applyLockState(locked, deadlineLabel) {
  el.deadlineLabel.textContent = deadlineLabel || "Torsdag kl 13:00";
  el.lockedDeadline.textContent = deadlineLabel || "Torsdag kl 13:00";
  el.lockedBanner.hidden = !locked;
  el.submit.textContent = locked ? "Anmälan stängd" : "Skicka mitt val";
}

async function refreshOrders() {
  try {
    const orders = await store.list();
    renderTally(orders);
    setError("");
  } catch (e) {
    setError(e.message);
  }
}

async function loadMenu() {
  try {
    const m = await store.menu();
    renderMenu(m.groups || []);
  } catch (e) {
    setError("Kunde inte läsa menyn: " + e.message);
  }
}

function refreshHeader() {
  const now = new Date();
  const friday = store.targetFriday(now);
  el.meetingDate.textContent = friday.getDate() + "/" + (friday.getMonth() + 1);
  applyLockState(store.isLocked(now), store.deadlineLabel(now));
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (store.isLocked()) {
    window.alert("Du är sent ute – anmälan stängde " + store.deadlineLabel() + ". Synka med Åsa, kanske går det att lösa ändå!");
    return;
  }

  const name = el.nameInput.value.trim();
  const dish = el.form.querySelector('input[name="dish"]:checked')?.value;

  if (!name || !dish) {
    setNotice(!name ? "Skriv ditt namn först." : "Välj en rätt först.");
    return;
  }

  setNotice("Sparar …");
  try {
    await store.add({ name, dish, allergies: el.allergyInput.value.trim() });
    el.form.reset();
    setNotice("Tack " + name + ", ditt val är registrerat.");
    refreshOrders();
  } catch (err) {
    setNotice("");
    setError(err.message);
  }
});

refreshHeader();
loadMenu();
refreshOrders();
setInterval(() => {
  refreshHeader();
  refreshOrders();
}, 20000);
