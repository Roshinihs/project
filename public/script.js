let latestCertificate = null;
let activeApiOrigin = "";

const wipeForm = document.getElementById("wipeForm");
const verifyForm = document.getElementById("verifyForm");
const progress = document.getElementById("progress");
const verifyResult = document.getElementById("verifyResult");
const certificateEmpty = document.getElementById("certificateEmpty");
const certificateCard = document.getElementById("certificateCard");
const certificateDetails = document.getElementById("certificateDetails");
const qrImage = document.getElementById("qrImage");
const verifyLink = document.getElementById("verifyLink");
const downloadButton = document.getElementById("downloadCert");
const wipeButton = document.getElementById("wipeButton");
const verifyButton = document.getElementById("verifyButton");

function getApiOrigins() {
  const origins = [];

  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    origins.push(window.location.origin);
  }

  origins.push("http://localhost:3001", "http://localhost:3000");

  return [...new Set(origins)];
}

async function apiFetch(path, options = {}) {
  const errors = [];

  for (const origin of getApiOrigins()) {
    try {
      const response = await fetch(`${origin}${path}`, options);

      if (response.status === 404 && origin !== getApiOrigins().at(-1)) {
        errors.push(`${origin}${path}: 404`);
        continue;
      }

      activeApiOrigin = origin;
      return response;
    } catch (error) {
      errors.push(`${origin}${path}: ${error.message}`);
    }
  }

  throw new Error(`Failed to connect to the backend. Tried ${errors.join("; ")}`);
}

function toBackendUrl(url) {
  if (!url || url.startsWith("http")) {
    return url;
  }

  return `${activeApiOrigin}${url}`;
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `status ${type}`.trim();
}

function renderCertificate(certificate) {
  latestCertificate = certificate;
  certificateEmpty.classList.add("hidden");
  certificateCard.classList.remove("hidden");
  downloadButton.disabled = false;

  const rows = [
    ["Certificate ID", certificate.id],
    ["File", certificate.file],
    ["Device", selectedDevice],
    ["Size", certificate.size],
    ["Wipe method", certificate.method],
    ["Overwrite Passes Completed", certificate.passes],
    ["Completed", new Date(certificate.time).toLocaleString()],
    ["Duration", certificate.duration],
    ["Status", certificate.status],
    ["Hash", certificate.hash],
  ];

  certificateDetails.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");

  qrImage.src = toBackendUrl(certificate.qr);
  verifyLink.href = certificate.verifyUrl || toBackendUrl(`/verify.html?id=${certificate.id}`);
}

function downloadCertificate() {
  if (!latestCertificate) {
    return;
  }

  const blob = new Blob([JSON.stringify(latestCertificate, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "certificate.json";
  link.click();

  URL.revokeObjectURL(url);
}

async function startWipe(event) {
  event.preventDefault();

  const fileInput = document.getElementById("fileInput");
  const mode = document.getElementById("mode").value;

  if (!fileInput.files.length) {
    setStatus(progress, "Choose a file before starting.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("mode", mode);

  wipeButton.disabled = true;
  setStatus(progress, "Uploading and wiping file...");

  try {
    const response = await apiFetch("/api/wipe", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Wipe failed.");
    }

    renderCertificate(data);
    setStatus(progress, "Wipe completed and certificate created.", "success");
    wipeForm.reset();
  } catch (error) {
    setStatus(progress, error.message, "error");
  } finally {
    wipeButton.disabled = false;
  }
}

async function verifyUploadedCertificate(event) {
  event.preventDefault();

  const certUpload = document.getElementById("certUpload");
  if (!certUpload.files.length) {
    setStatus(verifyResult, "Choose a certificate JSON file first.", "error");
    return;
  }

  verifyButton.disabled = true;
  setStatus(verifyResult, "Checking certificate...");

  try {
    const text = await certUpload.files[0].text();
    const certificate = JSON.parse(text);
    const response = await apiFetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(certificate),
    });
    const result = await response.json();

    setStatus(
      verifyResult,
      result.valid ? "Certificate is valid." : `Certificate is invalid. ${result.reason}`,
      result.valid ? "success" : "error"
    );
  } catch (error) {
    setStatus(verifyResult, "Could not read this certificate JSON file.", "error");
  } finally {
    verifyButton.disabled = false;
  }
}

wipeForm.addEventListener("submit", startWipe);
verifyForm.addEventListener("submit", verifyUploadedCertificate);
downloadButton.addEventListener("click", downloadCertificate);

let selectedPlatform = "Windows";
const platformCards = document.querySelectorAll(".platform-card");

platformCards.forEach((card) => {
  card.addEventListener("click", () => {
    selectedPlatform = card.dataset.platform;

    platformCards.forEach((item) => {
      const isSelected = item === card;
      item.classList.toggle("selected", isSelected);
      item.setAttribute("aria-checked", String(isSelected));
    });
  });
});

const platformDescriptions = {
  Windows: "Optimized for wiping files selected from Windows desktops and laptops.",
  Linux: "Suited for files selected from Linux workstations, servers, and removable drives.",
  Android: "Prepared for files selected from Android devices, exports, and shared storage.",
};
const selectedPlatformName = document.getElementById("selectedPlatformName");
const selectedPlatformDescription = document.getElementById("selectedPlatformDescription");
const selectedPlatformButton = document.getElementById("selectedPlatformButton");

platformCards.forEach((card) => {
  card.addEventListener("click", () => {
    selectedPlatformName.textContent = card.dataset.platform;
    selectedPlatformDescription.textContent = platformDescriptions[card.dataset.platform];
    selectedPlatformButton.textContent = `Download ${card.dataset.platform} Version`;
  });
});

selectedPlatformButton.addEventListener("click", () => {
  const blob = new Blob(["This is a simulated Windows Secure Wipe tool."], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "SecureWipe-Windows.exe";
  link.click();

  URL.revokeObjectURL(url);
});

let selectedDevice = "Laptop";
const deviceCards = document.querySelectorAll(".device-card");
const selectedDeviceDisplay = document.getElementById("selectedDeviceDisplay");
const deviceRequiredMessage = document.getElementById("deviceRequiredMessage");
const fileUploadInput = document.getElementById("fileInput");

deviceCards.forEach((card) => {
  card.addEventListener("click", () => {
    selectedDevice = card.dataset.device;
    selectedDeviceDisplay.textContent = `Selected Device: ${selectedDevice}`;
    fileUploadInput.disabled = false;
    deviceRequiredMessage.classList.add("hidden");

    deviceCards.forEach((item) => {
      const isSelected = item === card;
      item.classList.toggle("selected", isSelected);
      item.setAttribute("aria-checked", String(isSelected));
    });
  });
});

let selectedInstallPlatform = "Windows";
const installPlatformCards = document.querySelectorAll(".install-platform-card");

installPlatformCards.forEach((card) => {
  card.addEventListener("click", () => {
    selectedInstallPlatform = card.dataset.installPlatform;

    installPlatformCards.forEach((item) => {
      const isSelected = item === card;
      item.classList.toggle("selected", isSelected);
      item.setAttribute("aria-checked", String(isSelected));
    });
  });
});

let wipeMode = "File Wipe";
const wipeModeTabs = document.querySelectorAll(".wipe-mode-tab");
const platformSection = document.getElementById("platformSection");

function updateWipeModeVisibility() {
  wipeForm.classList.toggle("hidden", wipeMode === "Device Wipe");
  platformSection.classList.toggle("hidden", wipeMode === "File Wipe");
}

wipeModeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    wipeMode = tab.dataset.wipeMode;

    wipeModeTabs.forEach((item) => {
      const isSelected = item === tab;
      item.classList.toggle("selected", isSelected);
      item.setAttribute("aria-checked", String(isSelected));
    });

    updateWipeModeVisibility();
  });
});
